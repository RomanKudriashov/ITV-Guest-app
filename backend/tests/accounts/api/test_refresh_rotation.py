"""
РОТАЦИЯ REFRESH (партия 30, п.25 бэклога).

Каждое обновление выдаёт новый refresh, а старый гаснет. Повтор погашенного —
кража: гаснет вся цепочка этого входа. Две вкладки, обменявшие один refresh
почти одновременно, не выбивают человека — окно терпимости. На сервере только
отпечаток. Отзыв — по каждому поводу.

Проверяется поведением — предъявлением токенов, а не наличием полей в строке.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import StaffSession, User
from apps.accounts.services import sessions as session_svc
from apps.core.models import AuditLog
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

STAFF = ("admin@rotation.test", "hotel-admin-12345")
PLATFORM = ("root@rotation.test", "platform12345")


@pytest.fixture
def hotel():
    return provision_hotel(
        subdomain="rotation", name="Ротация", admin_email=STAFF[0], admin_password=STAFF[1]
    ).hotel


@pytest.fixture
def api(client, hotel):
    host = host_for(hotel)

    def login():
        return client.post(
            "/api/v1/staff/auth/login",
            data=json.dumps({"email": STAFF[0], "password": STAFF[1]}),
            content_type="application/json",
            HTTP_HOST=host,
        ).json()

    def refresh(token):
        response = client.post(
            "/api/v1/staff/auth/refresh",
            data=json.dumps({"refresh": token}),
            content_type="application/json",
            HTTP_HOST=host,
        )
        return response.status_code, (response.json() if response.status_code == 200 else {})

    return login, refresh


def _session(hotel):
    return StaffSession.all_objects.using("platform").filter(hotel_id=hotel.pk).order_by("-created_at").first()


def _age_rotation(hotel, seconds: int = 60):
    """Последняя ротация — давно: окно терпимости прошло."""
    session = _session(hotel)
    StaffSession.all_objects.using("platform").filter(pk=session.pk).update(
        rotated_at=timezone.now() - timedelta(seconds=seconds)
    )


def test_each_refresh_issues_a_new_one_and_the_old_one_dies(api, hotel):
    login, refresh = api
    first = login()["refresh"]
    status, body = refresh(first)
    assert status == 200
    second = body["refresh"]
    assert second and second != first, "обновление выдаёт новый refresh"

    _age_rotation(hotel)
    assert refresh(first)[0] == 401, "старый refresh после ротации — 401"


def test_reusing_a_dead_refresh_kills_the_whole_chain(api, hotel):
    """Кража: вор предъявил погашенный — гаснет и ветка хозяина."""
    login, refresh = api
    stolen = login()["refresh"]
    _, body = refresh(stolen)
    owners = body["refresh"]

    _age_rotation(hotel)
    assert refresh(stolen)[0] == 401
    assert refresh(owners)[0] == 401, "цепочка оборвана: и свежий refresh хозяина больше не работает"
    session = _session(hotel)
    assert session.revoked_at is not None and session.revoked_reason == "refresh_reused"
    assert AuditLog.objects.using("platform").filter(action="staff.session.refresh_reused").exists()


def test_two_tabs_refreshing_together_do_not_log_the_person_out(api, hotel):
    """
    Вкладки делят refresh: вторая предъявляет только что погашенный — в окне
    терпимости это не кража. Ответ — access без нового refresh; свежий refresh
    первой вкладки продолжает работать.
    """
    login, refresh = api
    shared = login()["refresh"]
    status_a, tab_a = refresh(shared)
    status_b, tab_b = refresh(shared)
    assert (status_a, status_b) == (200, 200)
    assert tab_b["access"] and tab_b["refresh"] is None, "вторая вкладка берёт refresh, положенный первой"
    assert refresh(tab_a["refresh"])[0] == 200, "человека не выбило"
    assert _session(hotel).revoked_at is None


def test_only_a_fingerprint_is_stored(api, hotel):
    import jwt
    from django.conf import settings

    login, _ = api
    token = login()["refresh"]
    jti = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])["jti"]
    session = _session(hotel)
    row = json.dumps(
        {f.name: str(getattr(session, f.name)) for f in StaffSession._meta.fields}, ensure_ascii=False
    )
    assert jti and jti not in row and token not in row
    assert session.refresh_hash == session_svc.fingerprint(jti, session.pk)


def test_a_refresh_issued_before_rotation_still_works_once(api, hotel):
    """Выкатка не выбивает: токен без идентификатора обменивается и переводит сессию на ротацию."""
    from apps.accounts.services.tokens import encode_refresh_token

    login, refresh = api
    login()
    session = _session(hotel)
    StaffSession.all_objects.using("platform").filter(pk=session.pk).update(refresh_hash="", previous_hash="")
    user = User.all_objects.using("platform").get(email=STAFF[0])
    legacy = encode_refresh_token(user, session_id=session.pk)
    status, body = refresh(legacy)
    assert status == 200 and body["refresh"]
    _age_rotation(hotel)
    assert refresh(legacy)[0] == 401, "после перевода старый токен — погашенный"


# --- Отзыв по поводам, которых раньше не было ---------------------------------


def test_deactivating_the_hotel_kills_staff_refresh(api, hotel, client):
    login, refresh = api
    token = login()["refresh"]
    ensure_platform_admin(email=PLATFORM[0], password=PLATFORM[1])
    access = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM[0], "password": PLATFORM[1]}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
    ).json()["access"]
    response = client.patch(
        f"/api/v1/platform/hotels/{hotel.pk}",
        data=json.dumps({"is_active": False}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {access}",
    )
    assert response.status_code == 200, response.content
    assert _session(hotel).revoked_reason == "hotel_deactivated"
    # Включили обратно — старый вход не ожил.
    client.patch(
        f"/api/v1/platform/hotels/{hotel.pk}",
        data=json.dumps({"is_active": True}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {access}",
    )
    assert refresh(token)[0] == 401


def test_deleting_the_hotel_kills_staff_sessions(api, hotel):
    from apps.hotels.services.platform import console

    login, _ = api
    login()
    console.delete_hotel_row(hotel)
    session = _session(hotel)
    assert session.revoked_at is not None and session.revoked_reason == "hotel_deleted"


def test_platform_resetting_the_admin_password_kills_their_refresh(api, hotel, settings):
    from apps.hotels.services.provisioning import set_hotel_admin

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    login, refresh = api
    token = login()["refresh"]
    set_hotel_admin(hotel, email=STAFF[0])
    assert refresh(token)[0] == 401
    assert _session(hotel).revoked_reason == "password_reset"


# Платформенное подключение здесь не читает записанного тестом — хватает отката.
@pytest.mark.django_db(databases=["default", "platform"])
def test_closing_a_console_session_from_the_registry_kills_its_refresh(client):
    ensure_platform_admin(email=PLATFORM[0], password=PLATFORM[1])

    def login():
        return client.post(
            "/api/v1/platform/auth/login",
            data=json.dumps({"email": PLATFORM[0], "password": PLATFORM[1]}),
            content_type="application/json",
            HTTP_HOST="guest.localhost",
        ).json()

    laptop, phone = login(), login()
    listing = client.get(
        "/api/v1/platform/auth/sessions",
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {laptop['access']}",
    ).json()
    other = listing["items"][0]["id"]
    closed = client.delete(
        f"/api/v1/platform/auth/sessions/{other}",
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {laptop['access']}",
    )
    assert closed.json()["ok"] is True
    status = client.post(
        "/api/v1/platform/auth/refresh",
        data=json.dumps({"refresh": phone["refresh"]}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
    ).status_code
    assert status == 401


# --- Отзыв действует СРАЗУ: живой access после отзыва — 401 ------------------


@pytest.fixture
def staff_api(client, hotel):
    host = host_for(hotel)

    def login(email=STAFF[0], password=STAFF[1]):
        return client.post(
            "/api/v1/staff/auth/login",
            data=json.dumps({"email": email, "password": password}),
            content_type="application/json",
            HTTP_HOST=host,
        ).json()

    def call(method, path, access, body=None):
        return getattr(client, method)(
            path,
            data=json.dumps(body) if body is not None else None,
            content_type="application/json",
            HTTP_HOST=host,
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )

    return login, call


# Платформенное подключение здесь не читает записанного тестом — хватает отката.
@pytest.mark.django_db(databases=["default", "platform"])
def test_deactivated_staff_access_is_refused_on_the_next_request(staff_api):
    login, call = staff_api
    admin = login()["access"]
    created = call(
        "post", "/api/v1/cms/staff", admin,
        {"email": "cook@rotation.test", "full_name": "Повар", "password": "cook-pass-12345"},
    )
    assert created.status_code == 201, created.content
    cook = login("cook@rotation.test", "cook-pass-12345")["access"]
    assert call("get", "/api/v1/staff/auth/me", cook).status_code == 200

    assert call("patch", f"/api/v1/cms/staff/{created.json()['id']}", admin, {"is_active": False}).status_code == 200
    assert call("get", "/api/v1/staff/auth/me", cook).status_code == 401


# Платформенное подключение здесь не читает записанного тестом — хватает отката.
@pytest.mark.django_db(databases=["default", "platform"])
def test_closed_session_access_is_refused_on_the_next_request(staff_api):
    """Закрыли вход с другого устройства — его access не работает со следующего запроса."""
    login, call = staff_api
    laptop, phone = login()["access"], login()["access"]
    assert call("get", "/api/v1/staff/auth/me", phone).status_code == 200  # кэш «жива» прогрет
    sessions = call("get", "/api/v1/staff/auth/sessions", laptop).json()["items"]
    other = next(item["id"] for item in sessions if not item.get("is_current"))
    assert call("delete", f"/api/v1/staff/auth/sessions/{other}", laptop).status_code == 200
    assert call("get", "/api/v1/staff/auth/me", phone).status_code == 401
    assert call("get", "/api/v1/staff/auth/me", laptop).status_code == 200


# Платформенное подключение здесь не читает записанного тестом — хватает отката.
@pytest.mark.django_db(databases=["default", "platform"])
def test_password_reset_refuses_live_access_at_once(staff_api, hotel, settings):
    from apps.hotels.services.provisioning import set_hotel_admin

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    login, call = staff_api
    access = login()["access"]
    assert call("get", "/api/v1/staff/auth/me", access).status_code == 200
    set_hotel_admin(hotel, email=STAFF[0])
    assert call("get", "/api/v1/staff/auth/me", access).status_code == 401


def test_hotel_deactivation_refuses_live_access_at_once(staff_api, hotel):
    from apps.accounts.services import sessions as session_svc

    login, call = staff_api
    access = login()["access"]
    assert call("get", "/api/v1/staff/auth/me", access).status_code == 200
    session_svc.revoke_hotel(hotel.pk, reason="hotel_deactivated")
    assert call("get", "/api/v1/staff/auth/me", access).status_code == 401


# Платформенное подключение здесь не читает записанного тестом — хватает отката.
@pytest.mark.django_db(databases=["default", "platform"])
def test_closed_console_session_access_is_refused_at_once(client):
    ensure_platform_admin(email=PLATFORM[0], password=PLATFORM[1])

    def login():
        return client.post(
            "/api/v1/platform/auth/login",
            data=json.dumps({"email": PLATFORM[0], "password": PLATFORM[1]}),
            content_type="application/json",
            HTTP_HOST="guest.localhost",
        ).json()

    def me(access):
        return client.get(
            "/api/v1/platform/auth/me", HTTP_HOST="guest.localhost", HTTP_AUTHORIZATION=f"Bearer {access}"
        ).status_code

    laptop, phone = login(), login()
    assert me(phone["access"]) == 200
    listing = client.get(
        "/api/v1/platform/auth/sessions", HTTP_HOST="guest.localhost", HTTP_AUTHORIZATION=f"Bearer {laptop['access']}"
    ).json()
    other = next(item["id"] for item in listing["items"] if not item.get("is_current"))
    client.delete(
        f"/api/v1/platform/auth/sessions/{other}",
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {laptop['access']}",
    )
    assert me(phone["access"]) == 401
    assert me(laptop["access"]) == 200


def test_access_without_session_is_refused(staff_api):
    """Токен персонала без `sid` и без гранта боевой код не выдаёт — его не принимают."""
    from apps.accounts.services.tokens import encode_staff_token

    _, call = staff_api
    user = User.all_objects.using("platform").get(email=STAFF[0])
    assert call("get", "/api/v1/staff/auth/me", encode_staff_token(user)).status_code == 401
