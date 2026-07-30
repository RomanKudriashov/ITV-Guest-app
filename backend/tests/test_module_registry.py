"""
Реестр модулей отеля (R1): платформа настраивает, отель читает.
Контракт — docs/module-registry-api-contract.md.
"""

from __future__ import annotations

import json

import pytest

from apps.hotels.models import HotelModule
from apps.hotels.provisioning import ensure_platform_admin

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
ALL_CODES = {code.value for code in HotelModule.Code}


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
                content_type="application/json", **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def test_registry_lists_all_codes_disabled_by_default(client, platform_token, crystal):
    body = _p(client, platform_token)("get", f"/hotels/{crystal.pk}/modules").json()
    assert {m["code"] for m in body["modules"]} == ALL_CODES
    assert all(m["is_enabled"] is False and m["source"] == "tariff" for m in body["modules"])


def test_put_enables_modules_tariff_and_override(client, platform_token, crystal):
    call = _p(client, platform_token)
    resp = call(
        "put",
        f"/hotels/{crystal.pk}/modules",
        {
            "tariff": "resort",
            "modules": [
                {"code": "multi_restaurant", "is_enabled": True},
                {"code": "pms", "is_enabled": True, "source": "override", "config": {"node": "local-1"}},
                {"code": "bogus", "is_enabled": True},  # неизвестный код игнорируется
            ],
        },
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["tariff"] == "resort"
    modules = {m["code"]: m for m in body["modules"]}
    assert modules["multi_restaurant"]["is_enabled"] is True
    assert modules["pms"]["source"] == "override" and modules["pms"]["config"]["node"] == "local-1"
    assert "bogus" not in modules
    # Идемпотентность: повторный GET отдаёт то же.
    again = call("get", f"/hotels/{crystal.pk}/modules").json()
    assert {m["code"]: m["is_enabled"] for m in again["modules"]}["multi_restaurant"] is True


def test_cms_reads_own_registry(client, platform_token, crystal, cms):
    _p(client, platform_token)(
        "put", f"/hotels/{crystal.pk}/modules", {"modules": [{"code": "marketing", "is_enabled": True}]}
    )
    body = cms.get("/api/v1/cms/modules").json()
    modules = {m["code"]: m for m in body["modules"]}
    assert set(modules) == ALL_CODES
    assert modules["marketing"]["is_enabled"] is True


def test_enabled_module_codes_helper(crystal):
    from apps.hotels.module_registry import enabled_module_codes, set_modules

    set_modules(crystal, [{"code": "payment", "is_enabled": True}, {"code": "pms", "is_enabled": False}])
    assert enabled_module_codes(crystal) == {"payment"}
