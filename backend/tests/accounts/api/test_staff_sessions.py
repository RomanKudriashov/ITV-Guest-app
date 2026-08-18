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

    rows = call("get", "/staff/auth/sessions", second["access"]).json()
    assert len(rows) >= 2
    current = [row for row in rows if row["is_current"]]
    assert len(current) == 1, "текущая сессия должна быть ровно одна"

    # Закрыть чужое устройство из списка — это и есть смысл экрана.
    other = next(row for row in rows if not row["is_current"])
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
