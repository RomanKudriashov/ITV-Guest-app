"""
WebSocket чата: реконсиляция снимком и явная авторизация без middleware.

Проверяется, что канал не открыт наружу (свой тред у гостя, свой отель у
персонала) и что одно сообщение доходит обеим сторонам вживую.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.core.context import tenant_context
from config.asgi import application

from .conftest import host_for, staff_token_for

pytestmark = pytest.mark.django_db(transaction=True)

WS_TIMEOUT = 10


@pytest.fixture
def guest_token(client, crystal):
    return client.post(
        "/api/guest/session",
        data={"room_number": "212"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]


@database_sync_to_async
def _thread_id_for_room(crystal, room="212"):
    from apps.chat.models import ChatThread

    with tenant_context(crystal):
        thread = ChatThread.objects.filter(room__number=room).first()
        return str(thread.pk) if thread else None


@database_sync_to_async
def _staff_send(crystal, thread_id, body):
    from apps.accounts.models import User
    from apps.chat.models import ChatThread
    from apps.chat.services import staff_send

    with tenant_context(crystal):
        user = User.objects.get(email="concierge@crystal.local")
        staff_send(ChatThread.objects.get(pk=thread_id), user, body)


def guest_ws(token, hotel="crystal"):
    return f"/ws/guest/chat/?token={token}&hotel={hotel}&lang=ru"


def staff_ws(thread_id, token, hotel="crystal"):
    return f"/ws/staff/chat/{thread_id}/?token={token}&hotel={hotel}&lang=ru"


# --- Авторизация -----------------------------------------------------------


def test_guest_chat_requires_valid_token(crystal):
    async def scenario():
        communicator = WebsocketCommunicator(application, guest_ws("garbage"))
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_staff_chat_refuses_other_hotel(client, crystal, aurora, guest_token):
    """JWT сотрудника Aurora на треде Crystal — чужой."""
    aurora_token = staff_token_for(client, aurora)

    async def scenario():
        # Гостю нужен тред — подключаемся, чтобы он создался.
        guest_comm = WebsocketCommunicator(application, guest_ws(guest_token))
        assert (await guest_comm.connect(timeout=WS_TIMEOUT))[0]
        await guest_comm.receive_json_from(timeout=WS_TIMEOUT)
        await guest_comm.disconnect()

        thread_id = await _thread_id_for_room(crystal)
        communicator = WebsocketCommunicator(
            application, staff_ws(thread_id, aurora_token, hotel="crystal")
        )
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


def test_guest_token_cannot_open_staff_chat(crystal, guest_token):
    async def scenario():
        guest_comm = WebsocketCommunicator(application, guest_ws(guest_token))
        assert (await guest_comm.connect(timeout=WS_TIMEOUT))[0]
        await guest_comm.receive_json_from(timeout=WS_TIMEOUT)
        await guest_comm.disconnect()

        thread_id = await _thread_id_for_room(crystal)
        communicator = WebsocketCommunicator(application, staff_ws(thread_id, guest_token))
        connected, code = await communicator.connect(timeout=WS_TIMEOUT)
        assert connected is False
        assert code == 4401

    async_to_sync(scenario)()


# --- Доставка --------------------------------------------------------------


def test_snapshot_on_connect_and_live_delivery_both_ways(client, crystal, guest_token):
    """
    Ради этого чат и написан: гость и персонал на одном треде, сообщение
    персонала прилетает гостю вживую полным снимком.
    """
    staff_jwt = staff_token_for(client, crystal, )

    async def scenario():
        guest_comm = WebsocketCommunicator(application, guest_ws(guest_token))
        assert (await guest_comm.connect(timeout=WS_TIMEOUT))[0]

        first = await guest_comm.receive_json_from(timeout=WS_TIMEOUT)
        assert first["type"] == "chat.snapshot"
        assert first["event"] == "connected"

        thread_id = await _thread_id_for_room(crystal)

        # Персонал пишет — гость получает снимок с новым сообщением.
        await _staff_send(crystal, thread_id, "Здравствуйте, чем помочь?")
        update = await guest_comm.receive_json_from(timeout=WS_TIMEOUT)
        assert update["event"] == "chat.message"
        bodies = [m["body"] for m in update["thread"]["messages"]]
        assert "Здравствуйте, чем помочь?" in bodies
        # Для гостя сообщение персонала — не своё.
        staff_msg = next(m for m in update["thread"]["messages"] if m["body"] == "Здравствуйте, чем помочь?")
        assert staff_msg["mine"] is False

        await guest_comm.disconnect()

    async_to_sync(scenario)()


def test_staff_sees_guest_message_live(client, crystal, guest_token):
    staff_jwt = staff_token_for(client, crystal)

    async def scenario():
        # Гость создаёт тред первым сообщением через REST.
        guest_comm = WebsocketCommunicator(application, guest_ws(guest_token))
        assert (await guest_comm.connect(timeout=WS_TIMEOUT))[0]
        await guest_comm.receive_json_from(timeout=WS_TIMEOUT)

        thread_id = await _thread_id_for_room(crystal)
        staff_comm = WebsocketCommunicator(application, staff_ws(thread_id, staff_jwt))
        assert (await staff_comm.connect(timeout=WS_TIMEOUT))[0]
        await staff_comm.receive_json_from(timeout=WS_TIMEOUT)

        # Гость пишет через REST-обёртку.
        await _guest_send(crystal, guest_token, "Нужен фен")
        update = await staff_comm.receive_json_from(timeout=WS_TIMEOUT)
        assert any(m["body"] == "Нужен фен" for m in update["thread"]["messages"])

        await guest_comm.disconnect()
        await staff_comm.disconnect()

    async_to_sync(scenario)()


@database_sync_to_async
def _guest_send(crystal, token, body):
    from apps.accounts.auth import authenticate_guest
    from apps.chat.services import guest_send

    with tenant_context(crystal):
        session = authenticate_guest(token)
        guest_send(session, body)
