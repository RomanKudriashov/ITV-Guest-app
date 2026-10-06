"""
ОТЗЫВ СЕССИИ ЗАКРЫВАЕТ ЕЁ УЖЕ ОТКРЫТЫЕ СОКЕТЫ (п.64 бэклога).

До правки отзыв действовал на HTTP и на новые подключения, а сокет, открытый
раньше (доска трекера, чат ресепшена), жил дальше и получал события. Здесь:
отзыв своей сессии закрывает сокет кодом 4401, отзыв ДРУГОЙ сессии того же
сотрудника его не трогает, «выйти везде» закрывает и чат ресепшена.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.accounts.services.tokens import decode_staff_token
from apps.core.context import tenant_context
from config.asgi import application

from tests.conftest import host_for, staff_token_for

pytestmark = pytest.mark.django_db(transaction=True)

WS_TIMEOUT = 10


def _sid(token: str) -> str:
    return decode_staff_token(token)["sid"]


@database_sync_to_async
def _revoke(crystal, token: str) -> None:
    from apps.accounts.services import sessions

    claims = decode_staff_token(token)
    with tenant_context(crystal):
        assert sessions.revoke(claims["sid"], user_id=claims["sub"], scope="staff")


@database_sync_to_async
def _revoke_all(crystal, token: str) -> None:
    from apps.accounts.services import sessions

    with tenant_context(crystal):
        assert sessions.revoke_all(decode_staff_token(token)["sub"], scope="staff") >= 1


async def _closed_with(communicator) -> int | None:
    """Код закрытия сокета, пропуская кадры данных, пришедшие до него."""
    for _ in range(10):
        output = await communicator.receive_output(timeout=WS_TIMEOUT)
        if output["type"] == "websocket.close":
            return output.get("code")
    return None


def test_revoking_the_session_closes_its_open_board(client, crystal):
    token = staff_token_for(client, crystal)

    async def scenario():
        board = WebsocketCommunicator(application, f"/ws/tracker/kitchen/?token={token}&hotel=crystal&lang=ru")
        assert (await board.connect(timeout=WS_TIMEOUT))[0]
        assert (await board.receive_json_from(timeout=WS_TIMEOUT))["event"] == "connected"

        await _revoke(crystal, token)
        assert await _closed_with(board) == 4401

    async_to_sync(scenario)()


def test_another_session_of_the_same_cook_stays_open(client, crystal):
    """Повар вышел на телефоне — доска на кухонном планшете работает дальше."""
    kitchen_tablet = staff_token_for(client, crystal)
    phone = staff_token_for(client, crystal)
    assert _sid(kitchen_tablet) != _sid(phone)

    async def scenario():
        board = WebsocketCommunicator(application, f"/ws/tracker/kitchen/?token={kitchen_tablet}&hotel=crystal&lang=ru")
        assert (await board.connect(timeout=WS_TIMEOUT))[0]
        await board.receive_json_from(timeout=WS_TIMEOUT)

        await _revoke(crystal, phone)
        assert await board.receive_nothing(timeout=1.5)
        await board.send_json_to({"type": "ping"})
        assert (await board.receive_json_from(timeout=WS_TIMEOUT))["type"] == "pong"
        await board.disconnect()

    async_to_sync(scenario)()


def test_logout_everywhere_closes_the_reception_chat(client, crystal):
    guest = client.post(
        "/api/guest/session", data={"room_number": "212"}, content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    token = staff_token_for(client, crystal, "reception")

    async def scenario():
        guest_chat = WebsocketCommunicator(application, f"/ws/guest/chat/?token={guest}&hotel=crystal&lang=ru")
        assert (await guest_chat.connect(timeout=WS_TIMEOUT))[0]
        await guest_chat.receive_json_from(timeout=WS_TIMEOUT)
        thread_id = await _thread_id(crystal)

        desk = WebsocketCommunicator(application, f"/ws/staff/chat/{thread_id}/?token={token}&hotel=crystal&lang=ru")
        assert (await desk.connect(timeout=WS_TIMEOUT))[0]
        assert (await desk.receive_json_from(timeout=WS_TIMEOUT))["event"] == "connected"

        await _revoke_all(crystal, token)
        assert await _closed_with(desk) == 4401
        await guest_chat.disconnect()

    async_to_sync(scenario)()


@database_sync_to_async
def _thread_id(crystal):
    from apps.chat.models import ChatThread

    with tenant_context(crystal):
        return str(ChatThread.objects.filter(room__number="212").first().pk)
