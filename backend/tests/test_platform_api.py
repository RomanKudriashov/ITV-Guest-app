"""
Платформенная консоль: логин, CRUD отелей, hotel-admin, деактивация,
безопасность (scope в обе стороны), аудит. Контракт — docs/platform-api-contract.md.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel
from apps.hotels.provisioning import ensure_platform_admin, provision_hotel

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"


@pytest.fixture
def platform_token(client):
    ensure_platform_admin(email="root@platform.test", password="platform12345")
    resp = client.post(
        "/api/v1/platform/auth/login",
        data={"email": "root@platform.test", "password": "platform12345"},
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


def _p(client, token):
    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)
    return call


# --- Логин -----------------------------------------------------------------


def test_platform_login_and_wrong_password(client):
    ensure_platform_admin(email="root@platform.test", password="platform12345")
    ok = client.post("/api/v1/platform/auth/login",
                     data={"email": "root@platform.test", "password": "platform12345"},
                     content_type="application/json", HTTP_HOST=BASE_HOST)
    assert ok.status_code == 200 and ok.json()["access"]
    bad = client.post("/api/v1/platform/auth/login",
                      data={"email": "root@platform.test", "password": "nope"},
                      content_type="application/json", HTTP_HOST=BASE_HOST)
    assert bad.status_code == 401


# --- CRUD отелей -----------------------------------------------------------


def test_create_list_get_hotel(client, platform_token):
    call = _p(client, platform_token)
    created = call("post", "/hotels", {
        "subdomain": "grand", "name": "Grand Hotel", "admin_email": "a@grand.test",
        "languages": ["en", "ru"], "preset": "midnight_navy",
    })
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["admin"]["password"]  # сгенерирован, показан один раз
    assert body["hotel"]["default_language"] == "en"

    listing = call("get", "/hotels").json()
    grand = next(h for h in listing if h["subdomain"] == "grand")
    assert grand["is_active"] is True
    assert set(grand["counts"]) == {"rooms", "staff", "items"}
    assert grand["counts"]["staff"] >= 1  # созданный hotel-admin

    hid = body["hotel"]["id"]
    profile = call("get", f"/hotels/{hid}").json()
    assert {lang["code"] for lang in profile["languages"]} == {"en", "ru"}


def test_duplicate_subdomain_conflict(client, platform_token):
    call = _p(client, platform_token)
    call("post", "/hotels", {"subdomain": "grand", "name": "G", "admin_email": "a@grand.test"})
    dup = call("post", "/hotels", {"subdomain": "grand", "name": "G2", "admin_email": "b@grand.test"})
    assert dup.status_code == 409
    assert dup.json()["code"] == "hotel_exists"


def test_patch_profile_and_set_admin(client, platform_token):
    call = _p(client, platform_token)
    hid = call("post", "/hotels", {"subdomain": "grand", "name": "Grand", "admin_email": "a@grand.test"}).json()["hotel"]["id"]

    patched = call("patch", f"/hotels/{hid}", {"name": "Grand Renamed", "currency": "EUR"})
    assert patched.status_code == 200
    assert patched.json()["name"] == "Grand Renamed"
    assert patched.json()["currency"] == "EUR"

    reset = call("post", f"/hotels/{hid}/admins", {"email": "a@grand.test"})
    assert reset.status_code == 200
    assert reset.json()["password"]  # новый пароль показан один раз


# --- Деактивация -----------------------------------------------------------


def test_deactivation_blocks_storefront_but_platform_still_sees(client, platform_token):
    call = _p(client, platform_token)
    hid = call("post", "/hotels", {"subdomain": "grand", "name": "Grand", "admin_email": "a@grand.test"}).json()["hotel"]["id"]

    call("patch", f"/hotels/{hid}", {"is_active": False})

    # Витрина: поддомен больше не резолвится (middleware фильтрует is_active).
    session = client.post("/api/guest/session", data={"room_number": "1"},
                          content_type="application/json", HTTP_HOST="grand.guest.localhost")
    assert session.status_code != 200

    # Платформа отель по-прежнему видит — деактивированным.
    grand = next(h for h in call("get", "/hotels").json() if h["subdomain"] == "grand")
    assert grand["is_active"] is False


# --- Безопасность (scope в обе стороны) ------------------------------------


def test_platform_token_rejected_by_cms(client, platform_token):
    # Реальный отель, чтобы поддомен резолвился — проверяем именно отказ auth,
    # а не «отель не найден».
    provision_hotel(subdomain="grand", name="Grand", admin_email="a@grand.test")
    resp = client.get("/api/v1/cms/bootstrap", HTTP_HOST="grand.guest.localhost",
                      HTTP_AUTHORIZATION=f"Bearer {platform_token}")
    assert resp.status_code in (401, 403)


def test_staff_token_rejected_by_platform(client, platform_token):
    # Тенантный staff-токен не пускается в платформенные ручки.
    result = provision_hotel(subdomain="grand", name="Grand", admin_email="a@grand.test",
                             admin_password="owner12345")
    login = client.post("/api/staff/auth/login",
                        data={"email": "a@grand.test", "password": "owner12345"},
                        content_type="application/json", HTTP_HOST="grand.guest.localhost")
    assert login.status_code == 200, login.content
    staff_token = login.json()["access"]

    resp = client.get("/api/v1/platform/hotels", HTTP_HOST=BASE_HOST,
                      HTTP_AUTHORIZATION=f"Bearer {staff_token}")
    assert resp.status_code in (401, 403)


# --- Аудит -----------------------------------------------------------------


def test_actions_are_audited(client, platform_token):
    call = _p(client, platform_token)
    hid = call("post", "/hotels", {"subdomain": "grand", "name": "Grand", "admin_email": "a@grand.test"}).json()["hotel"]["id"]
    call("patch", f"/hotels/{hid}", {"is_active": False})

    hotel = Hotel.objects.get(subdomain="grand")
    with tenant_context(hotel):
        actions = set(AuditLog.objects.values_list("action", flat=True))
    assert "platform.hotel.created" in actions
    assert "platform.hotel.deactivated" in actions
