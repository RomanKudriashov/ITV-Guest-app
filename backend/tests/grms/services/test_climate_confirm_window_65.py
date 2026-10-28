"""
ОКНО ПОДТВЕРЖДЕНИЯ КЛИМАТА (партия 65).

Замер на настоящем iRidi объекта: свет и шторы подтверждаются за 1,5–2 с, а
фанкойл примерно в каждой третьей команде — за 11–12,5 с. С общим окном 3,7 с
кондиционер уходил в «не подтвердилось» и через десять секунд всё равно
срабатывал. Климату — своё окно, свету — прежнее.
"""

from __future__ import annotations

import pytest

from apps.grms import tasks
from apps.grms.services import commands, inflight


class _Room:
    pk = "room-1"
    number = "100"


class _Context:
    def __init__(self, kind):
        self.device = "Modbus TCP Server (Slave mode) 100"
        self.payload = {"subdevice": ""}
        self.room = _Room()
        self.controls = [self._control(kind)]
        self.kind = kind

    @staticmethod
    def _control(kind):
        return {"controlId": "x", "kind": kind, "channels": {"toggle": {"command": "C_X", "feedback": "F_X"}}}

    def control(self, control_id):
        return self.controls[0]


@pytest.mark.parametrize(
    "kind, expected",
    [
        ("air_conditioner", commands.CONFIRM_DELAYS_CLIMATE_S),
        ("heating", commands.CONFIRM_DELAYS_CLIMATE_S),
        ("light_group", commands.CONFIRM_DELAYS_S),
    ],
)
def test_bite_climate_waits_longer_than_light(kind, expected, monkeypatch):
    from apps.grms.services import guest

    seen = {}
    monkeypatch.setattr(guest, "resolve_context", lambda hotel, session: (_Context(kind), ""))
    monkeypatch.setattr(commands, "send_command", lambda hotel, **kw: seen.update(kw) or {"result": "confirmed"})
    monkeypatch.setattr(commands, "forget_reads", lambda *a, **kw: None)

    class _Hotel:
        pk = "h"

    class _Rooms:
        @staticmethod
        def filter(**kw):
            class _Q:
                @staticmethod
                def first():
                    return _Room()
            return _Q()

    from apps.hotels import models as hotel_models

    monkeypatch.setattr(hotel_models.Room, "objects", _Rooms)
    monkeypatch.setattr(tasks, "tenant_context", lambda hotel: __import__("contextlib").nullcontext())
    tasks._execute(_Hotel(), "room-1", "x", "toggle", 1)
    assert seen["confirm_delays"] == expected


def test_climate_window_fits_inside_the_element_lock():
    """Окно климата короче блокировки элемента — иначе замок спадёт посреди ожидания."""
    assert sum(commands.CONFIRM_DELAYS_CLIMATE_S) < inflight.INFLIGHT_TTL_S
    assert sum(commands.CONFIRM_DELAYS_CLIMATE_S) >= 12.5, "короче замеренных 12,5 с на объекте"
