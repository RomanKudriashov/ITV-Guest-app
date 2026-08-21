"""
АДМИНИСТРАТОРЫ ОТЕЛЯ: список, снятие, защита последнего.

Списка админов не существовало нигде — ни в консоли, ни в API. Опечатка в
адресе при заведении молча добавляла ВТОРОГО полноправного администратора, и
увидеть это было негде, а убрать — нечем.
"""

from __future__ import annotations

import json

import pytest

from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
EMAIL = "root@platform.test"
PASSWORD = "platform12345"


@pytest.fixture
def api(client):
    ensure_platform_admin(email=EMAIL, password=PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}",
                data=json.dumps(body),
                content_type="application/json",
                **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


@pytest.fixture
def hotel(db):
    return provision_hotel(
        subdomain="admins", name="Админы", admin_email="owner@admins.test"
    ).hotel


def test_admins_are_listed(api, hotel):
    """Список есть — до этой правки его не было нигде."""
    body = api("get", f"/hotels/{hotel.pk}/admins").json()
    assert [a["email"] for a in body["admins"]] == ["owner@admins.test"]
    assert body["admins"][0]["is_active"] is True


def test_second_admin_is_reported_when_added(api, hotel):
    """
    ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Второй админ бывает нужен (передача дел), но
    чаще это опечатка в адресе — и раньше она проходила молча.
    """
    response = api(
        "post", f"/hotels/{hotel.pk}/admins", {"email": "typo@admins.test"}
    )
    assert response.status_code == 200, response.content
    # Сервер называет тех, кто уже был: оператор видит, что заводит ВТОРОГО.
    assert response.json()["existing_admins"] == ["owner@admins.test"]

    listed = api("get", f"/hotels/{hotel.pk}/admins").json()["admins"]
    assert len(listed) == 2


def test_extra_admin_can_be_removed_and_loses_access(api, hotel, client):
    """
    УКУС. Убрали лишнего — он больше не админ.

    Учётку не стираем: у человека могут быть заказы, сообщения и записи в
    журнале, и удаление сделало бы их безымянными. Снимается право.
    """
    api("post", f"/hotels/{hotel.pk}/admins", {"email": "typo@admins.test"})
    with tenant_context(hotel):
        extra = User.objects.get(email="typo@admins.test")
        assert extra.is_hotel_admin is True

    removed = api("delete", f"/hotels/{hotel.pk}/admins/{extra.pk}")
    assert removed.status_code == 200, removed.content

    with tenant_context(hotel):
        extra.refresh_from_db()
        assert extra.is_hotel_admin is False
        # Человек остался сотрудником — исчезло только право.
        assert extra.is_active is True

    remaining = api("get", f"/hotels/{hotel.pk}/admins").json()["admins"]
    assert [a["email"] for a in remaining] == ["owner@admins.test"]


def test_the_last_admin_cannot_be_removed(api, hotel):
    """
    УКУС. Последнего убрать нельзя: отель остался бы без доступа к своей CMS, и
    вернуть его можно было бы только через платформу.

    Отказ, а не предупреждение: цена ошибки — запертый снаружи клиент.
    """
    with tenant_context(hotel):
        only = User.objects.get(is_hotel_admin=True)

    response = api("delete", f"/hotels/{hotel.pk}/admins/{only.pk}")
    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "last_admin"
    # Текст объясняет, ЧТО ДЕЛАТЬ, а не только что нельзя.
    assert "нового" in body["detail"], body["detail"]

    with tenant_context(hotel):
        only.refresh_from_db()
        assert only.is_hotel_admin is True


def test_removing_an_unknown_admin_is_not_found(api, hotel):
    import uuid

    response = api("delete", f"/hotels/{hotel.pk}/admins/{uuid.uuid4()}")
    assert response.status_code == 404


def test_admin_removal_is_audited(api, hotel):
    """«Почему у отеля пропал доступ» спрашивают позже — ответ должен быть."""
    from apps.core.models import AuditLog

    api("post", f"/hotels/{hotel.pk}/admins", {"email": "typo@admins.test"})
    with tenant_context(hotel):
        extra = User.objects.get(email="typo@admins.test")
    api("delete", f"/hotels/{hotel.pk}/admins/{extra.pk}")

    # Журнал — тенантная таблица: без контекста отеля RLS не отдаст строку.
    with tenant_context(hotel):
        entry = AuditLog.objects.filter(action="platform.hotel.admin_removed").first()
    assert entry is not None
    assert entry.payload["email"] == "typo@admins.test"
