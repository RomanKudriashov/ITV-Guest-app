"""
ОТЕЛЬ СОКЕТА — ИЗ АДРЕСА, А НЕ ИЗ ПАРАМЕТРА (партия 58а, п.0).

Витрина собрана одна на все отели и в адрес сокета кладёт
`hotel=<VITE_HOTEL_SUBDOMAIN || 'crystal'>`. Сокет брал этот параметр РАНЬШЕ
Host — и в проде гость любого отеля, кроме «Кристалла», стучался в «Кристалл»:
его токен там чужой, сокет закрывался, живой статус заказа, чат и номер молча
не работали. HTTP так не ошибался: заголовок и `?hotel=` он слушает только при
`GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER` (= DEBUG). Теперь у сокета то же правило.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import override_settings

from apps.core.context import tenant_context
from config.asgi import application

from tests.conftest import host_for

pytestmark = pytest.mark.django_db(transaction=True)

WS_TIMEOUT = 10


@database_sync_to_async
def _room_number(hotel) -> str:
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return Room.objects.order_by("number").values_list("number", flat=True).first()


def _guest_token(client, hotel, room: str) -> str:
    response = client.post(
        "/api/guest/session",
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


async def _connects(path: str, host: str) -> bool:
    communicator = WebsocketCommunicator(application, path, headers=[(b"host", host.encode())])
    connected, _ = await communicator.connect(timeout=WS_TIMEOUT)
    if not connected:
        return False
    # Принятое соединение консьюмер может закрыть сразу (чужой токен) —
    # успех только когда пришёл снимок.
    try:
        message = await communicator.receive_json_from(timeout=WS_TIMEOUT)
    except Exception:  # noqa: BLE001 — закрытие вместо снимка и есть отказ
        return False
    finally:
        await communicator.disconnect()
    return message.get("type") == "chat.snapshot"


def test_prod_guest_socket_takes_the_hotel_from_host_not_from_the_param(client, crystal, aurora):
    """Гость Aurora на своём адресе, фронт прислал `hotel=crystal` — сокет его."""
    room = async_to_sync(_room_number)(aurora)
    token = _guest_token(client, aurora, room)

    with override_settings(GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER=False):
        ok = async_to_sync(_connects)(f"/ws/v1/guest/chat/?token={token}&hotel=crystal", host_for(aurora))
    assert ok, "гость не-crystal отеля в проде отвергнут: сокет взял ?hotel=crystal раньше Host"


def test_prod_param_cannot_switch_the_hotel(client, crystal, aurora):
    """Обратное: на адресе «Кристалла» параметр `hotel=aurora` отель не меняет."""
    room = async_to_sync(_room_number)(aurora)
    token = _guest_token(client, aurora, room)

    with override_settings(GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER=False):
        ok = async_to_sync(_connects)(f"/ws/v1/guest/chat/?token={token}&hotel=aurora", host_for(crystal))
    assert not ok, "в проде параметр подменил отель сокета"


def test_dev_param_still_selects_the_hotel(client, crystal, aurora):
    """В деве (флаг включён) параметр работает: WS идёт мимо прокси и поддомена нет."""
    room = async_to_sync(_room_number)(aurora)
    token = _guest_token(client, aurora, room)

    with override_settings(GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER=True):
        ok = async_to_sync(_connects)(f"/ws/v1/guest/chat/?token={token}&hotel=aurora", "localhost:8010")
    assert ok, "в деве параметр перестал выбирать отель"
