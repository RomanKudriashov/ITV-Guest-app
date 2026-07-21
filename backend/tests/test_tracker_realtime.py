"""
WebSocket трекера: авторизация без middleware, скоуп точки, доставка событий.

Главное, что здесь проверяется, — что WS-канал НЕ открыт наружу. У WebSocket
нет ни аутентификации, ни резолвера тенанта, ни проверки прав: всё это
консьюмер обязан делать сам. Тесты бьют ровно по этим трём местам.

И отдельно — что одно событие доходит одновременно до кухни и до гостя: ради
этого весь срез и собирался.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.core.context import tenant_context
from config.asgi import application

from .conftest import host_for, staff_token_for

# transaction=True: событие эмитится в transaction.on_commit, а в обычном
# TestCase транзакция не коммитится — снимок бы не пришёл.
pytestmark = pytest.mark.django_db(transaction=True)

WS_TIMEOUT = 10


def tracker_url(point: str, token: str, hotel: str = "crystal") -> str:
    return f"/ws/tracker/{point}/?token={token}&hotel={hotel}&lang=ru"


def guest_url(order_id: str, token: str, hotel: str = "crystal") -> str:
    return f"/ws/guest/order/{order_id}/?token={token}&hotel={hotel}&lang=ru"


@pytest.fixture
def staff_token(client, crystal):
    return staff_token_for(client, crystal)


@pytest.fixture
def guest(client, crystal):
    """Гостевая сессия и всё, что нужно, чтобы оформить заказ из теста."""
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]

    def get(path):
        return client.get(
            path, HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {token}"
        ).json()

    menu = get("/api/guest/menu")
    item_id = next(
        entry["id"]
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "caesar"
    )
    location_id = next(
        entry["id"]
        for entry in get("/api/guest/locations")["locations"]
        if entry["code"] == "in_room"
    )
    return {"token": token, "item_id": item_id, "location_id": location_id, "client": client}


def place_order(guest, crystal, key="ws-order-1") -> dict:
    response = guest["client"].post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": guest["item_id"], "quantity": 1}],
            "location_id": guest["location_id"],
            "timing": "asap",
        },
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest['token']}",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert response.status_code == 201, response.content
    return response.json()


@database_sync_to_async
def _place_order_async(guest, crystal, key):
    return place_order(guest, crystal, key)


@database_sync_to_async
def _accept(crystal, staff_email, order_id):
    from apps.accounts.models import User
    from apps.orders.tracker import accept_order

    with tenant_context(crystal):
        user = User.objects.get(email=staff_email)
        return accept_order(user, order_id)


# --- Авторизация -----------------------------------------------------------


def test_tracker_requires_a_valid_staff_token(crystal):
    """У WS нет middleware — токен проверяет сам консьюмер."""

    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("kitchen", "garbage"))
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_tracker_refuses_a_point_the_staffer_is_not_assigned_to(crystal, staff_token):
    """
    Повар привязан к кухне, но не к бару. Токен валиден — и всё равно отказ:
    привязку проверяет тот же сервисный слой, что и REST.
    """

    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("bar", staff_token))
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4403

    async_to_sync(scenario)()


def test_tracker_refuses_unknown_point(crystal, staff_token):
    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("nowhere", staff_token))
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4403

    async_to_sync(scenario)()


def test_tracker_refuses_staff_of_another_hotel(client, crystal, aurora):
    """Токен сотрудника Aurora на поддомене «Кристалла» — чужой."""
    aurora_token = staff_token_for(client, aurora)

    async def scenario():
        communicator = WebsocketCommunicator(
            application, tracker_url("kitchen", aurora_token, hotel="crystal")
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_tracker_refuses_a_guest_token(crystal, guest):
    async def scenario():
        communicator = WebsocketCommunicator(
            application, tracker_url("kitchen", guest["token"])
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_tracker_refuses_unknown_hotel(crystal, staff_token):
    async def scenario():
        communicator = WebsocketCommunicator(
            application, tracker_url("kitchen", staff_token, hotel="nope")
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4404

    async_to_sync(scenario)()


# --- Доставка --------------------------------------------------------------


def test_board_snapshot_on_connect(crystal, staff_token, guest):
    place_order(guest, crystal, key="snapshot-1")

    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("kitchen", staff_token))
        assert (await communicator.connect(timeout=WS_TIMEOUT))[0]

        message = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert message["type"] == "tracker.snapshot"
        assert message["event"] == "connected"

        board = message["board"]
        assert board["point"]["code"] == "kitchen"
        # Колонки — из пресета отеля, а не захардкожены на клиенте.
        assert [column["code"] for column in board["columns"]] == [
            "new",
            "accepted",
            "preparing",
            "on_the_way",
        ]
        assert len(board["columns"][0]["orders"]) == 1
        # Язык подставляется из отеля: у WS нет Accept-Language.
        assert board["columns"][0]["orders"][0]["items"][0]["title"] == "Салат «Цезарь»"

        await communicator.disconnect()

    async_to_sync(scenario)()


def test_new_order_lands_on_the_board_in_real_time(crystal, staff_token, guest):
    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("kitchen", staff_token))
        assert (await communicator.connect(timeout=WS_TIMEOUT))[0]

        first = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert first["board"]["columns"][0]["orders"] == []

        order = await _place_order_async(guest, crystal, "live-1")

        message = await communicator.receive_json_from(timeout=WS_TIMEOUT)
        assert message["event"] == "order.created"
        # order_id отдаётся отдельно — по нему клиент даёт звук и подсветку.
        assert message["order_id"] == order["id"]
        assert [entry["number"] for entry in message["board"]["columns"][0]["orders"]] == [
            order["number"]
        ]

        await communicator.disconnect()

    async_to_sync(scenario)()


def test_one_event_reaches_the_kitchen_and_the_guest_at_once(crystal, staff_token, guest):
    """
    Ради этого весь срез и собирался: сотрудник принял заказ — доска и экран
    гостя обновились от ОДНОГО события, без опроса и без ручной синхронизации.
    """
    order = place_order(guest, crystal, key="both-1")

    async def scenario():
        kitchen = WebsocketCommunicator(application, tracker_url("kitchen", staff_token))
        assert (await kitchen.connect(timeout=WS_TIMEOUT))[0]
        await kitchen.receive_json_from(timeout=WS_TIMEOUT)

        guest_socket = WebsocketCommunicator(
            application, guest_url(order["id"], guest["token"])
        )
        assert (await guest_socket.connect(timeout=WS_TIMEOUT))[0]
        await guest_socket.receive_json_from(timeout=WS_TIMEOUT)

        await _accept(crystal, "chef@crystal.local", order["id"])

        kitchen_message = await kitchen.receive_json_from(timeout=WS_TIMEOUT)
        guest_message = await guest_socket.receive_json_from(timeout=WS_TIMEOUT)

        accepted = kitchen_message["board"]["columns"][1]
        assert accepted["code"] == "accepted"
        assert [entry["number"] for entry in accepted["orders"]] == [order["number"]]
        assert accepted["orders"][0]["assignee"]["name"] == "Пётр, повар"

        assert guest_message["order"]["status"]["code"] == "accepted"

        await kitchen.disconnect()
        await guest_socket.disconnect()

    async_to_sync(scenario)()


def test_other_points_board_does_not_move(crystal, client, staff_token, guest):
    """Заказ на кухню не должен дёргать доску бара."""
    from apps.accounts.models import StaffAssignment, User
    from apps.hotels.models import ExecutionPoint

    with tenant_context(crystal):
        bartender = User.objects.create_user(
            email="bar@crystal.local", password="chef12345", hotel=crystal, full_name="Бармен"
        )
        StaffAssignment.objects.create(
            user=bartender, execution_point=ExecutionPoint.objects.get(code="bar")
        )

    bar_token = client.post(
        "/api/staff/auth/login",
        data={"email": "bar@crystal.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["access"]

    async def scenario():
        bar = WebsocketCommunicator(application, tracker_url("bar", bar_token))
        assert (await bar.connect(timeout=WS_TIMEOUT))[0]
        await bar.receive_json_from(timeout=WS_TIMEOUT)

        await _place_order_async(guest, crystal, "bar-quiet")

        assert await bar.receive_nothing(timeout=2), "бар получил чужое событие"
        await bar.disconnect()

    async_to_sync(scenario)()


def test_ping_keeps_the_board_socket_alive(crystal, staff_token):
    async def scenario():
        communicator = WebsocketCommunicator(application, tracker_url("kitchen", staff_token))
        assert (await communicator.connect(timeout=WS_TIMEOUT))[0]
        await communicator.receive_json_from(timeout=WS_TIMEOUT)

        await communicator.send_json_to({"type": "ping"})
        assert (await communicator.receive_json_from(timeout=WS_TIMEOUT))["type"] == "pong"
        await communicator.disconnect()

    async_to_sync(scenario)()
