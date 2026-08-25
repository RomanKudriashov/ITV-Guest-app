"""
СХЕМА АДРЕСОВ: что на каком хосте существует.

    <корень>               лендинг платформы
    <корень>/admin         наша консоль
    <отель>.<корень>       гостевое приложение отеля
    <отель>.<корень>/admin CMS этого отеля

Здесь проверяется серверная половина: консоль отвечает ТОЛЬКО на корне. До
разведения платформенные пути были освобождены от требования тенанта, а
значит отвечали на любом хосте — в том числе на адресе отеля, где вход в
консоль выдавал токен и открывал флот со всеми отелями. Экран мы там не
рисовали, но экран не рубеж: адрес открывается прямой ссылкой.
"""

from __future__ import annotations

import json

import pytest

from tests.conftest import host_for

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"

BASE_HOST = "guest.localhost"


def _login(client, host: str):
    return client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=host,
    )


def test_the_console_does_not_open_from_a_hotel_address(client, crystal):
    """
    УКУС. С адреса отеля консоль не открывается — и это 404, а не отказ.

    Отказ означал бы «она здесь есть, но вам нельзя», то есть подсказывал бы,
    что мастер-ключ лежит на этом же хосте. Её здесь нет.
    """
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)

    response = _login(client, host_for(crystal))
    assert response.status_code == 404, response.content
    assert response.json()["code"] == "platform_wrong_host"

    # И не только вход: любая платформенная ручка с этого хоста не существует.
    token = _login(client, BASE_HOST).json()["access"]
    fleet = client.get(
        "/api/v1/platform/hotels",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert fleet.status_code == 404, "флот отвечает с адреса отеля"
    assert fleet.json()["code"] == "platform_wrong_host"


def test_the_console_still_opens_from_the_root(client, crystal):
    """
    ОБРАТНАЯ СТОРОНА: на корне консоль работает. Иначе «закрыли всё» тоже
    прошло бы за успех.
    """
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)

    login = _login(client, BASE_HOST)
    assert login.status_code == 200, login.content

    fleet = client.get(
        "/api/v1/platform/hotels",
        HTTP_HOST=BASE_HOST,
        HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}",
    )
    assert fleet.status_code == 200


def test_the_hotel_keeps_its_own_api_on_its_own_address(cms, crystal):
    """Правило про консоль не задело тенантные ручки: отель работает как работал."""
    response = cms.client.get(
        "/api/v1/cms/bootstrap",
        HTTP_HOST=host_for(cms.hotel),
        HTTP_AUTHORIZATION=f"Bearer {cms.token}",
    )
    assert response.status_code == 200


def test_the_node_still_checks_in_from_the_hotel_address(client, crystal):
    """
    Он-прем узел рубежом НЕ ЗАДЕТ.

    Отметка узла (`/api/v1/onprem/…`) тоже освобождена от тенанта, но это не
    консоль: коннектор на объекте знает свой ключ и приходит по тому адресу,
    который ему прописали при установке. Запереть его вместе с консолью значило
    бы погасить управление номером у всех, кому в конфиг вписан адрес отеля.
    """
    response = client.post(
        "/api/v1/onprem/heartbeat",
        data=json.dumps({"key": "definitely-not-a-key"}),
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    # 401 — ключ не тот. Важно, что дошло до проверки ключа, а не до 404 хоста.
    assert response.status_code == 401
    assert response.json()["code"] == "node_key_rejected"


def test_the_admin_email_carries_the_new_address(crystal, settings, mailoutbox):
    """
    Письмо администратору ведёт в `/admin` на адресе отеля.

    Проверяем ТЕЛО ПИСЬМА, а не строчку в исходнике: адрес собирается в одном
    месте, но подставляется в другом, и «функция та» ничего не говорит о том,
    что уехало человеку.
    """
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

    from apps.hotels.services import admin_credentials

    admin_credentials.send_admin_password(
        crystal, email="admin@crystal.test", password="whatever12345", is_new=True
    )

    assert len(mailoutbox) == 1
    body = mailoutbox[0].body
    assert f"{crystal.subdomain}.guest.localhost/admin" in body, body
    assert "/login" not in body, "в письме остался старый адрес входа"
