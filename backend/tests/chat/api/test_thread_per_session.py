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


def test_the_home_screen_does_not_create_a_thread(client, crystal):
    guest = guest_for(client, crystal, room="212")
    with tenant_context(crystal):
        before = ChatThread.objects.count()
    for _ in range(3):
        assert guest.get("/api/guest/home").json()["unread_chat"] == 0
    with tenant_context(crystal):
        assert ChatThread.objects.count() == before, "главная не заводит пустых тредов"


def test_the_home_counter_still_counts_staff_replies(client, crystal):
    from apps.accounts.models import User
    from apps.chat.services import staff_send

    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "вопрос"}).json()["thread_id"]
    with tenant_context(crystal):
        staff_send(ChatThread.objects.get(pk=thread_id), User.objects.get(email="reception@crystal.local"), "ответ")
    assert guest.get("/api/guest/home").json()["unread_chat"] == 1
    guest.post("/api/guest/chat/read", {})
    assert guest.get("/api/guest/home").json()["unread_chat"] == 0


def test_a_race_on_the_first_open_leaves_one_thread(client, crystal, monkeypatch):
    """
    Первое открытие чата и сокет спрашивали «найти или создать» одновременно и
    заводили по треду: гость слушал один, писали в другой. Моделируем
    проигравшего: поиск уже отстал, а победитель тред завёл.
    """
    from django.db import IntegrityError

    from apps.accounts.models import GuestSession
    from apps.chat.services import threads

    guest = guest_for(client, crystal, room="212")
    winner_id = guest.get("/api/guest/chat").json()["thread_id"]
    with tenant_context(crystal):
        session = ChatThread.objects.get(pk=winner_id).guest_session
        with pytest.raises(IntegrityError):
            from django.db import transaction

            with transaction.atomic():
                ChatThread.objects.create(hotel=crystal, guest_session=session)

        real_filter = ChatThread.objects.filter
        calls = {"n": 0}

        def stale_filter(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return ChatThread.objects.none()
            return real_filter(*args, **kwargs)

        monkeypatch.setattr(threads.ChatThread.objects, "filter", stale_filter)
        loser = threads.get_or_create_thread(GuestSession.objects.get(pk=session.pk))
        monkeypatch.undo()
        assert str(loser.pk) == winner_id, "проигравший берёт тред победителя"
        assert ChatThread.objects.filter(guest_session=session).count() == 1
