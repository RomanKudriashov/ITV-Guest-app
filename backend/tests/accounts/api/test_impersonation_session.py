"""
Вход под аудитом: три дыры одного механизма.

1. Токен уезжал в адресной строке (`?support=…`) — то есть в историю браузера,
   в `Referer` и в логи прокси, где переживал сессию, ради которой выдан.
2. Отозвать сессию было нечем: грант создавался и не проверялся больше нигде,
   а подписанный JWT живёт до истечения срока сам по себе.
3. Отель не видел, что внутри него работает поддержка.

Проверяется поведение, а не наличие полей: код ищется в ответе ПО ЗНАЧЕНИЮ,
отзыв — следующим запросом тем же токеном.
"""

from __future__ import annotations

import json

import pytest

from apps.accounts.models import ImpersonationGrant
from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

BASE_HOST = "guest.localhost"
OWNER = ("root@platform.test", "platform12345")


@pytest.fixture
def hotel():
    return provision_hotel(
        subdomain="entered", name="Под аудитом", admin_email="admin@entered.test",
        admin_password="hotel-admin-12345",
    ).hotel


@pytest.fixture
def api(client):
    ensure_platform_admin(email=OWNER[0], password=OWNER[1])
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": OWNER[0], "password": OWNER[1]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw)
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def _enter(api, hotel, reason="разбор обращения"):
    resp = api("post", f"/hotels/{hotel.pk}/enter", {"reason": reason})
    assert resp.status_code == 200, resp.content
    return resp.json()


def _exchange(client, hotel, code):
    return client.post(
        "/api/v1/staff/auth/support-exchange",
        data=json.dumps({"code": code}), content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )


def _cms(client, hotel, token, path="/api/v1/cms/bootstrap"):
    return client.get(path, HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}")


# --- 1. Токена нет в адресной строке ----------------------------------------


def test_enter_hands_out_a_code_not_a_token(api, hotel):
    """
    Наружу уходит одноразовый код. Токена в ответе нет — искать его надо ПО
    ЗНАЧЕНИЮ: поле могло бы приехать под другим именем.
    """
    granted = _enter(api, hotel)

    assert "code" in granted and len(granted["code"]) > 20
    # JWT узнаётся по своей форме, а не по имени ключа.
    assert "access" not in granted
    body = json.dumps(granted)
    assert "eyJ" not in body, f"в ответе лежит JWT: {body}"


def test_code_works_once(api, hotel, client):
    """Повторное открытие той же ссылки второй сессии не даёт."""
    code = _enter(api, hotel)["code"]

    first = _exchange(client, hotel, code)
    assert first.status_code == 200, first.content
    assert first.json()["access"]

    second = _exchange(client, hotel, code)
    assert second.status_code == 401
    assert second.json()["code"] == "support_code_invalid"


def test_code_of_another_hotel_does_not_work(api, hotel, client):
    """Код обменивается только на своём поддомене — тенант выбран адресом."""
    other = provision_hotel(
        subdomain="foreign", name="Чужой", admin_email="a@foreign.test",
        admin_password="x-12345",
    ).hotel
    code = _enter(api, hotel)["code"]

    assert _exchange(client, other, code).status_code == 401


# --- 2. Отзыв ломает уже выданный токен -------------------------------------


def test_revoked_grant_breaks_an_issued_token(api, hotel, client):
    """
    ГЛАВНОЕ. Токен выдан и работает; после отзыва тот же токен отвергается
    на СЛЕДУЮЩЕМ запросе.

    Проверка при выдаче ничего бы не значила: подписанный JWT живёт своей
    жизнью до истечения срока, и «оборвать сессию» без проверки на каждом
    запросе — обещание на будущее.
    """
    granted = _enter(api, hotel)
    token = _exchange(client, hotel, granted["code"]).json()["access"]

    assert _cms(client, hotel, token).status_code == 200, "до отзыва токен работает"

    revoked = api("post", f"/impersonations/{granted['grant_id']}/revoke")
    assert revoked.status_code == 200, revoked.content

    after = _cms(client, hotel, token)
    assert after.status_code in (401, 403), f"отозванный токен всё ещё пускает: {after.status_code}"


def test_expired_grant_breaks_the_token_too(api, hotel, client):
    """Истёкший срок работает так же, как отзыв: сессии больше нет."""
    from django.utils import timezone
    from datetime import timedelta

    granted = _enter(api, hotel)
    token = _exchange(client, hotel, granted["code"]).json()["access"]
    # Грант тенантный и под RLS: из теста читаем платформенным подключением.
    with platform_scope():
        ImpersonationGrant.all_objects.using("platform").filter(
            pk=granted["grant_id"]
        ).update(expires_at=timezone.now() - timedelta(minutes=1))

    assert _cms(client, hotel, token).status_code in (401, 403)


def test_revocation_lands_in_the_journal(api, hotel, client):
    granted = _enter(api, hotel)
    _exchange(client, hotel, granted["code"])
    api("post", f"/impersonations/{granted['grant_id']}/revoke")

    with tenant_context(hotel):
        actions = set(AuditLog.objects.values_list("action", flat=True))
    assert "impersonation.revoked" in actions


def test_hotel_admin_cannot_revoke(api, hotel, client):
    """
    Отель сессию ВИДИТ, но не рвёт: иначе разбор инцидента блокируется изнутри
    того самого отеля, который разбирают. Решение осознанное.
    """
    granted = _enter(api, hotel)
    _exchange(client, hotel, granted["code"])
    admin_token = client.post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": "admin@entered.test", "password": "hotel-admin-12345"}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()["access"]

    # Платформенной ручки у отеля нет вовсе — токен персонала туда не ходит.
    resp = client.post(
        f"/api/v1/platform/impersonations/{granted['grant_id']}/revoke",
        HTTP_HOST=BASE_HOST, HTTP_AUTHORIZATION=f"Bearer {admin_token}",
    )
    assert resp.status_code in (401, 403)
    with platform_scope():
        grant = ImpersonationGrant.all_objects.using("platform").get(pk=granted["grant_id"])
    assert grant.revoked_at is None, "сессию оборвал тот, кому нельзя"


# --- 3. Отель видит присутствие ---------------------------------------------


def test_hotel_sees_the_support_session(api, hotel, client):
    """Баннер собирается из bootstrap и виден ЛЮБОМУ пользователю CMS отеля."""
    granted = _enter(api, hotel, reason="чиним витрину")
    _exchange(client, hotel, granted["code"])

    admin_token = client.post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": "admin@entered.test", "password": "hotel-admin-12345"}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()["access"]

    payload = _cms(client, hotel, admin_token).json()
    session = payload["support_session"]
    assert session is not None, "отель не видит чужого присутствия"
    assert session["actor"] == OWNER[0]
    assert session["reason"] == "чиним витрину"
    assert session["started_at"] and session["expires_at"]


def test_no_session_no_banner(api, hotel, client):
    """«Никого нет» — это null, а не пустой объект: их видно по-разному."""
    admin_token = client.post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": "admin@entered.test", "password": "hotel-admin-12345"}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()["access"]

    assert _cms(client, hotel, admin_token).json()["support_session"] is None


def test_revoked_session_disappears_from_the_banner(api, hotel, client):
    granted = _enter(api, hotel)
    _exchange(client, hotel, granted["code"])
    api("post", f"/impersonations/{granted['grant_id']}/revoke")

    admin_token = client.post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": "admin@entered.test", "password": "hotel-admin-12345"}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()["access"]

    assert _cms(client, hotel, admin_token).json()["support_session"] is None


# --- 4. Список активных сессий ----------------------------------------------


def test_active_sessions_are_listed(api, hotel, client):
    granted = _enter(api, hotel, reason="смотрим заказы")
    _exchange(client, hotel, granted["code"])

    rows = api("get", "/impersonations").json()
    row = next(r for r in rows if r["id"] == granted["grant_id"])
    assert row["subdomain"] == "entered"
    assert row["actor"] == OWNER[0]
    assert row["reason"] == "смотрим заказы"
    assert row["entered"] is True

    api("post", f"/impersonations/{granted['grant_id']}/revoke")
    assert all(r["id"] != granted["grant_id"] for r in api("get", "/impersonations").json())


# --- 5. Рефреш не продлевает вход под аудитом -------------------------------


def test_support_session_gets_no_refresh_token(api, hotel, client):
    """
    Обмен кода отдаёт ОДИН access и ничего больше.

    У входа под аудитом свой срок — срок гранта, и продлевать его нечем: это
    условие механизма, а не деталь. Появись здесь refresh — сессия поддержки
    жила бы неделю наравне с обычной, и «вошли на полчаса» превратилось бы в
    обещание, которого никто не проверяет.
    """
    granted = _enter(api, hotel)
    body = _exchange(client, hotel, granted["code"]).json()

    assert body["access"]
    assert "refresh" not in body, f"входу под аудитом выдан refresh: {body}"


def test_support_session_cannot_be_extended_through_refresh(api, hotel, client):
    """
    Даже предъявив свой access ручке обновления, поддержка не получает пару.

    Проверяется поведением: сначала токен работает, потом им же стучимся в
    /auth/refresh — и получаем отказ, а не новую неделю.
    """
    granted = _enter(api, hotel)
    token = _exchange(client, hotel, granted["code"]).json()["access"]

    assert _cms(client, hotel, token).status_code == 200

    refreshed = client.post(
        "/api/v1/staff/auth/refresh",
        data=json.dumps({"refresh": token}),
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert refreshed.status_code == 401, refreshed.content
    assert refreshed.json()["code"] == "session_expired"


def test_support_session_dies_when_its_grant_expires(api, hotel, client):
    """
    Грант вышел по сроку — токен мёртв, и никакое обновление его не воскрешает.

    Срок двигаем в базе, а не ждём полчаса: проверяется правило, а не часы.
    """
    from django.utils import timezone
    from datetime import timedelta

    granted = _enter(api, hotel)
    token = _exchange(client, hotel, granted["code"]).json()["access"]
    assert _cms(client, hotel, token).status_code == 200

    # Через тенант-контекст: грант лежит в тенантной таблице под RLS, и
    # `all_objects` из платформенного скоупа до него не дотягивается — на этом
    # же месте оступается и рабочий код отзыва (он ходит `.using("platform")`).
    with tenant_context(hotel):
        ImpersonationGrant.all_objects.filter(pk=granted["grant_id"]).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )

    # Сам токен больше не пускает.
    assert _cms(client, hotel, token).status_code == 401
    # И обменять его на новую пару тоже нельзя.
    refreshed = client.post(
        "/api/v1/staff/auth/refresh",
        data=json.dumps({"refresh": token}),
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert refreshed.status_code == 401
