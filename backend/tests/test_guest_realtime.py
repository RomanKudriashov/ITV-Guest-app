"""
Живой статус по WebSocket.

Проверяется весь путь целиком: смена статуса персоналом → событие после
коммита → шина → группа Channels → снимок у гостя. Половинчатая проверка
(«событие ушло в шину») ничего не доказала бы: между шиной и гостем ещё три
звена, и ломаться они умеют независимо.

Тест синхронный, а асинхронные куски гоняются через async_to_sync — так не
нужен pytest-asyncio, и данные готовятся обычным ORM.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.core.context import tenant_context
from config.asgi import application

from .conftest import host_for

# transaction=True обязателен: событие эмитится в transaction.on_commit, а в
# обычном TestCase транзакция никогда не коммитится — и снимок не пришёл бы.
pytestmark = pytest.mark.django_db(transaction=True)

WS_TIMEOUT = 10


@pytest.fixture
def guest_order(client, crystal):
    """Гостевая сессия и оформленный заказ — обычным HTTP, как это делает витрина."""
    session = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()
    token = session["token"]

    def guest_get(path):
        return client.get(
            path, HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {token}"
        ).json()

    menu = guest_get("/api/guest/menu")
    item = next(
        entry
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "caesar"
    )
    location_id = next(
        entry["id"]
        for entry in guest_get("/api/guest/locations")["locations"]
        if entry["code"] == "in_room"
    )

    created = client.post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "location_id": location_id,
            "timing": "asap",
        },
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="ws-1",
    )
    assert created.status_code == 201, created.content
    return {"token": token, "order": created.json()}


def ws_url(order_id: str, token: str, hotel_subdomain: str = "crystal") -> str:
    # hotel в query — потому что у WebSocket нет vite-прокси с заголовками.
    return f"/ws/guest/order/{order_id}/?token={token}&hotel={hotel_subdomain}"


@database_sync_to_async
def _change_status(crystal, order_id: str, code: str):
    from apps.orders.services import change_status, get_order

    with tenant_context(crystal):
        change_status(get_order(order_id), to_code=code, actor_type="staff")


def test_snapshot_arrives_on_connect_and_on_every_change(crystal, guest_order):
    order_id = guest_order["order"]["id"]
    token = guest_order["token"]

    async def scenario():
        communicator = WebsocketCommunicator(application, ws_url(order_id, token))
        connected, _ = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected, "гостевой WebSocket не подключился"

        # 1. Снимок сразу после подключения — клиенту не нужен отдельный REST.
        first = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert first["type"] == "order.snapshot"
        assert first["order"]["id"] == order_id
        assert first["order"]["status"]["code"] == "new"

        # 2. Персонал двигает статус — снимок прилетает сам.
        await _change_status(crystal, order_id, "accepted")
        second = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert second["event"] == "order.status_changed"
        assert second["order"]["status"]["code"] == "accepted"
        # Приходит ПОЛНЫЙ объект, а не дельта: клиент заменяет состояние
        # целиком и не может рассинхронизироваться.
        assert [entry["code"] for entry in second["order"]["history"]] == ["new", "accepted"]
        assert second["order"]["items"]

        await _change_status(crystal, order_id, "preparing")
        third = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert third["order"]["status"]["code"] == "preparing"
        assert third["order"]["status"]["allows_guest_cancel"] is False

        await communicator.disconnect()

    async_to_sync(scenario)()


def test_reconnect_gets_current_state_not_replayed_history(crystal, guest_order):
    """
    Гость потерял сеть, статус за это время сменился дважды. После
    переподключения он обязан увидеть АКТУАЛЬНОЕ состояние, а не догонять
    пропущенные события — в этом и смысл реконсиляции.
    """
    order_id = guest_order["order"]["id"]
    token = guest_order["token"]

    async def scenario():
        first = WebsocketCommunicator(application, ws_url(order_id, token))
        assert (await first.connect(timeout=WS_TIMEOUT))[0]
        await first.receive_json_from(timeout=WS_TIMEOUT)
        await first.disconnect()

        # «Офлайн»: два перехода мимо гостя.
        await _change_status(crystal, order_id, "accepted")
        await _change_status(crystal, order_id, "preparing")

        again = WebsocketCommunicator(application, ws_url(order_id, token))
        assert (await again.connect(timeout=WS_TIMEOUT))[0]
        snapshot = await again.receive_json_from(timeout=WS_TIMEOUT)

        assert snapshot["order"]["status"]["code"] == "preparing"
        assert [entry["code"] for entry in snapshot["order"]["history"]] == [
            "new",
            "accepted",
            "preparing",
        ]
        await again.disconnect()

    async_to_sync(scenario)()


def test_cancellation_reaches_the_guest(crystal, guest_order):
    order_id = guest_order["order"]["id"]
    token = guest_order["token"]

    async def scenario():
        communicator = WebsocketCommunicator(application, ws_url(order_id, token))
        assert (await communicator.connect(timeout=WS_TIMEOUT))[0]
        await communicator.receive_json_from(timeout=WS_TIMEOUT)

        await _change_status(crystal, order_id, "cancelled")
        message = await communicator.receive_json_from(timeout=WS_TIMEOUT)

        assert message["event"] == "order.cancelled"
        assert message["order"]["status"]["is_cancelled"] is True
        await communicator.disconnect()

    async_to_sync(scenario)()


def test_ping_keeps_the_socket_alive(crystal, guest_order):
    order_id = guest_order["order"]["id"]

    async def scenario():
        communicator = WebsocketCommunicator(application, ws_url(order_id, guest_order["token"]))
        assert (await communicator.connect(timeout=WS_TIMEOUT))[0]
        await communicator.receive_json_from(timeout=WS_TIMEOUT)

        await communicator.send_json_to({"type": "ping"})
        assert (await communicator.receive_json_from(timeout=WS_TIMEOUT))["type"] == "pong"
        await communicator.disconnect()

    async_to_sync(scenario)()


# --- Кто НЕ должен подключиться -------------------------------------------


def test_bad_token_is_rejected(crystal, guest_order):
    async def scenario():
        communicator = WebsocketCommunicator(
            application, ws_url(guest_order["order"]["id"], "totally-not-a-token")
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_another_guests_order_is_rejected(client, crystal, guest_order):
    """Токен другой сессии не открывает чужой заказ."""
    stranger = client.post(
        "/api/guest/session",
        data={"room_number": "201"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]

    async def scenario():
        communicator = WebsocketCommunicator(
            application, ws_url(guest_order["order"]["id"], stranger)
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_unknown_hotel_is_rejected(crystal, guest_order):
    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            ws_url(guest_order["order"]["id"], guest_order["token"], hotel_subdomain="nope"),
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4404

    async_to_sync(scenario)()
