"""
Тред чата принадлежит сессии гостя, а не номеру.

Проверено до правки: после выезда новый гость номера открывал чат и читал
переписку прежнего; второй телефон в том же номере — тоже.
"""

from __future__ import annotations

import pytest

from apps.chat.models import ChatThread
from apps.core.context import tenant_context
from apps.hotels.models import Room
from tests.chat.api.test_chat_reviews import guest_for, staff_call

pytestmark = pytest.mark.django_db


def _bodies(guest) -> list[str]:
    return [message["body"] for message in guest.get("/api/guest/chat").json()["messages"]]


def test_the_next_guest_of_the_room_does_not_read_the_previous_one(client, crystal, cms):
    first = guest_for(client, crystal, room="212")
    first.post("/api/guest/chat", {"body": "секрет первого гостя"})
    with tenant_context(crystal):
        room_id = str(Room.objects.get(number="212").pk)
    assert cms.post(f"/api/cms/rooms/{room_id}/checkout").status_code == 200

    second = guest_for(client, crystal, room="212")
    assert "секрет первого гостя" not in _bodies(second)
    second.post("/api/guest/chat", {"body": "вопрос второго"})
    assert _bodies(second) == ["вопрос второго"]


def test_a_second_phone_in_the_same_room_has_its_own_thread(client, crystal):
    one = guest_for(client, crystal, room="212")
    one.post("/api/guest/chat", {"body": "с первого телефона"})
    other = guest_for(client, crystal, room="212")
    assert "с первого телефона" not in _bodies(other)


def test_old_threads_stay_for_the_staff(client, crystal, cms):
    first = guest_for(client, crystal, room="212")
    first.post("/api/guest/chat", {"body": "для разбора"})
    guest_for(client, crystal, room="212").post("/api/guest/chat", {"body": "другой гость"})

    threads = staff_call(client, crystal, "reception")("/api/tracker/chat/threads").json()["items"]
    with tenant_context(crystal):
        assert ChatThread.objects.filter(room__number="212").count() == 2, "номер виден у обоих"
    assert len([t for t in threads if t.get("room") == "212"]) == 2
