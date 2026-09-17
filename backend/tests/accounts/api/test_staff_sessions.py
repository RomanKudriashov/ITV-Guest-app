"""
Реестр сессий: выход отзывает, «везде» рвёт всё, смена пароля щадит текущую.

До реестра «выйти» означало только «забыть токены в этом браузере»: копия
refresh, снятая заранее, работала ещё неделю. Проверяется поведением — копией
токена, а не наличием строки в таблице.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import StaffSession, User
from apps.core.context import tenant_context
from apps.hotels.services.provisioning import provision_hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

STAFF = ("admin@sessions.test", "hotel-admin-12345")


@pytest.fixture
def hotel():
    return provision_hotel(
        subdomain="sessions", name="Сессии", admin_email=STAFF[0],
        admin_password=STAFF[1],
    ).hotel


@pytest.fixture
def api(client, hotel):
    host = host_for(hotel)

    def login(password=STAFF[1]):
        return client.post(
            "/api/v1/staff/auth/login",
            data=json.dumps({"email": STAFF[0], "password": password}),
            content_type="application/json", HTTP_HOST=host,
        ).json()

    def refresh(token):
        return client.post(
            "/api/v1/staff/auth/refresh",
            data=json.dumps({"refresh": token}),
            content_type="application/json", HTTP_HOST=host,
        ).status_code

    def call(method, path, token, body=None):
        kw = {"HTTP_HOST": host, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1{path}", data=json.dumps(body),
                content_type="application/json", **kw)
        return getattr(client, method)(f"/api/v1{path}", **kw)

    return login, refresh, call


def test_logout_kills_only_this_session(api):
    """
    ГЛАВНОЕ. Копия refresh, снятая до выхода, после выхода не обменивается.

    И рвётся ТОЛЬКО эта сессия: выход на ноутбуке не выкидывает с телефона.
    """
    login, refresh, call = api
    laptop, phone = login(), login()
    stolen_copy = laptop["refresh"]

    assert refresh(stolen_copy) == 200, "до выхода обмен обязан работать"

    assert call("post", "/staff/auth/logout", laptop["access"]).status_code == 200

    assert refresh(stolen_copy) == 401, "копия refresh пережила выход"
    assert refresh(phone["refresh"]) == 200, "выход на одном устройстве оборвал другое"


def test_logout_all_closes_every_session(api):
    login, refresh, call = api
    first, second, third = login(), login(), login()

    body = call("post", "/staff/auth/logout-all", third["access"]).json()
    assert body["closed"] >= 3

    for name, tokens in (("первая", first), ("вторая", second), ("текущая", third)):
        assert refresh(tokens["refresh"]) == 401, f"{name} сессия пережила «выйти везде»"


def test_password_change_keeps_the_session_it_was_made_from(api, hotel):
    """
    Смена СВОЕГО пароля закрывает остальные сессии и ОСТАВЛЯЕТ текущую.

    Раньше это решал отпечаток пароля в токене: он рвал всё разом, и человек,
    сменивший себе пароль, выкидывал сам себя с экрана, где только что
    подтвердил, что это он.
    """
    login, refresh, call = api
    here, elsewhere = login(), login()
    with tenant_context(hotel):
        me = User.objects.get(email=STAFF[0])

    changed = call(
        "patch", f"/cms/staff/{me.pk}", here["access"],
        {"password": "another-strong-12345"},
    )
    assert changed.status_code == 200, changed.content

    assert refresh(here["refresh"]) == 200, "сессия, из которой меняли пароль, закрылась"
    assert refresh(elsewhere["refresh"]) == 401, "чужое устройство пережило смену пароля"


def test_admin_changing_someone_elses_password_closes_all_their_sessions(api, hotel):
    """Чужую учётку админ закрывает целиком: это, как правило, ответ на инцидент."""
    login, refresh, call = api
    admin = login()

    with tenant_context(hotel):
        victim = User.objects.create_user(
            email="cook@sessions.test", password="cook-strong-12345",
            hotel_id=hotel.pk, full_name="Повар", is_staff_member=True,
        )

    victim_tokens = client_login(call, hotel, "cook@sessions.test", "cook-strong-12345")
    assert refresh(victim_tokens["refresh"]) == 200

    changed = call(
        "patch", f"/cms/staff/{victim.pk}", admin["access"],
        {"password": "reset-by-admin-12345"},
    )
    assert changed.status_code == 200, changed.content
    assert refresh(victim_tokens["refresh"]) == 401


def client_login(call, hotel, email, password):
    """Вход другого сотрудника тем же клиентом."""
    from django.test import Client

    return Client().post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()


def test_sessions_are_listed_with_the_current_one_marked(api):
    login, refresh, call = api
    first = login()
    second = login()

    page = call("get", "/staff/auth/sessions", second["access"]).json()
    assert page["current"]["is_current"] is True, "текущая сессия отмечена"
    assert page["total"] >= 1
    assert not any(row["is_current"] for row in page["items"]), "текущая — только полем current"

    # Закрыть чужое устройство из списка — это и есть смысл экрана.
    other = page["items"][0]
    assert call("delete", f"/staff/auth/sessions/{other['id']}", second["access"]).json()["ok"]
    assert refresh(first["refresh"]) == 401


def test_expired_rows_are_purged_on_login(api, hotel):
    """Реестр не растёт вечно: отработавшие строки убирает следующий вход."""
    login, _refresh, _call = api
    login()

    with tenant_context(hotel):
        # Двигаем строки далеко за срок хранения.
        StaffSession.all_objects.update(expires_at=timezone.now() - timedelta(days=400))
        assert StaffSession.all_objects.count() >= 1

    login()  # следующий вход подметает за собой

    with tenant_context(hotel):
        rows = list(StaffSession.all_objects.all())
    assert len(rows) == 1, f"старые строки не убраны: осталось {len(rows)}"
    assert rows[0].is_active


def test_a_long_history_comes_in_pages_and_the_current_one_is_always_there(api):
    """
    7 936 живых сессий у администратора стенда давали профиль на 620 000 px.
    Список — страницами, а текущая сессия приходит всегда, даже если по
    активности она не попала бы на первую страницу.
    """
    login, _refresh, call = api
    mine = login()
    for _ in range(25):
        login()

    first = call("get", "/staff/auth/sessions", mine["access"]).json()
    assert first["current"] is not None
    assert len(first["items"]) == 20
    assert first["total"] >= 25
    assert first["has_more"] is True

    rest = call("get", "/staff/auth/sessions?offset=20&limit=100", mine["access"]).json()
    assert rest["has_more"] is False
    assert len(first["items"]) + len(rest["items"]) == first["total"]
    ids = {row["id"] for row in first["items"]} | {row["id"] for row in rest["items"]}
    assert first["current"]["id"] not in ids
    assert len(ids) == first["total"], "страницы не повторяют и не теряют строк"

    capped = call("get", "/staff/auth/sessions?limit=10000", mine["access"]).json()
    assert capped["limit"] == 100, "страница не безразмерная, сколько ни попроси"


def _staff_member(call, admin_access, email):
    created = call(
        "post", "/cms/staff", admin_access,
        {"email": email, "full_name": "Уходящий", "password": "cook-12345"},
    )
    assert created.status_code == 201, created.content
    return created.json()["id"]


def _live_sessions(hotel, email) -> int:
    with tenant_context(hotel):
        return StaffSession.objects.filter(
            user__email=email, revoked_at__isnull=True, expires_at__gt=timezone.now()
        ).count()


def _login_as(client, hotel, email, password="cook-12345"):
    from django.test import Client

    response = Client().post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()


def test_switching_a_member_off_closes_their_sessions(api, hotel, client):
    """Выйти из-под выключенного нельзя — его входы закрываются сразу."""
    login, refresh, call = api
    admin = login()
    member_id = _staff_member(call, admin["access"], "off@sessions.test")
    first = _login_as(client, hotel, "off@sessions.test")
    _login_as(client, hotel, "off@sessions.test")
    assert _live_sessions(hotel, "off@sessions.test") == 2

    response = call("patch", f"/cms/staff/{member_id}", admin["access"], {"is_active": False})
    assert response.status_code == 200, response.content
    assert _live_sessions(hotel, "off@sessions.test") == 0
    assert refresh(first["refresh"]) == 401
    assert _live_sessions(hotel, STAFF[0]) >= 1, "сессии того, кто выключал, не тронуты"


def test_deleting_a_member_closes_their_sessions(api, hotel, client):
    login, _refresh, call = api
    admin = login()
    member_id = _staff_member(call, admin["access"], "gone@sessions.test")
    _login_as(client, hotel, "gone@sessions.test")
    assert _live_sessions(hotel, "gone@sessions.test") == 1

    assert call("delete", f"/cms/staff/{member_id}", admin["access"]).status_code == 200
    with tenant_context(hotel):
        live = StaffSession.all_objects.filter(
            user__email="gone@sessions.test", revoked_at__isnull=True
        ).count()
    assert live == 0
