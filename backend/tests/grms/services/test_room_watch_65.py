"""
НАБЛЮДЕНИЕ ЗА ОТКРЫТЫМИ НОМЕРАМИ (партия 65).

Свет выключили на стене — iRidi узнаёт за 2 с, но никому не сообщает. Пока у
номера открыт экран, служба читает его раз в 2 с и будит экраны, если
состояние изменилось не нашей командой.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from django.core.cache import cache

from apps.grms.services import watch


@pytest.fixture(autouse=True)
def _clean():
    cache.clear()
    watch._client().delete(watch.INDEX_KEY)
    yield
    watch._client().delete(watch.INDEX_KEY)
    cache.clear()


def test_open_screen_is_watched_until_its_mark_expires(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(watch.time, "time", lambda: now[0])
    watch.mark_watched("h1", "r1")
    assert watch.watched() == [("h1", "r1")]
    now[0] += watch.WATCH_TTL_S + 1
    assert watch.watched() == [], "сокет оборвался без прощания — номер больше не читаем"


class _Result:
    def __init__(self, value, ok=True):
        self.value, self.ok = value, ok


@pytest.fixture
def room(monkeypatch, crystal):
    from apps.grms import tasks
    from apps.grms.services import guest, inflight

    state = {"values": {"F_Light 0": 0}, "busy": {}}
    woke = []
    context = SimpleNamespace(controls=[{"controlId": "light.x"}])
    monkeypatch.setattr(guest, "resolve_context_for_room", lambda hotel, room_id: (context, ""))
    monkeypatch.setattr(guest, "_read_state", lambda ctx: ({k: _Result(v) for k, v in state["values"].items()}, ""))
    monkeypatch.setattr(inflight, "active_controls", lambda *a: state["busy"])
    monkeypatch.setattr(tasks, "broadcast_room", lambda hotel_id, room_id, *, event, command=None: woke.append(event))
    return SimpleNamespace(hotel=str(crystal.pk), state=state, woke=woke)


@pytest.mark.django_db
def test_bite_change_on_the_wall_wakes_the_screen_once(room):
    assert watch.check_room(room.hotel, "r1") is False, "первое чтение — только запомнить"
    assert watch.check_room(room.hotel, "r1") is False, "ничего не изменилось — не будить"
    room.state["values"]["F_Light 0"] = 1  # выключатель на стене
    assert watch.check_room(room.hotel, "r1") is True
    assert room.woke == ["state"]
    assert watch.check_room(room.hotel, "r1") is False


@pytest.mark.django_db
def test_room_with_a_command_in_flight_is_left_alone(room):
    room.state["busy"] = {"light.x": object()}
    reads = []
    from apps.grms.services import guest

    original = guest._read_state
    guest._read_state = lambda ctx: reads.append(1) or original(ctx)
    try:
        assert watch.check_room(room.hotel, "r1") is False
    finally:
        guest._read_state = original
    assert reads == [], "подтверждение команды читает само — лишнее чтение не нужно"
