"""
Молчит комната — недоступна комната. Молчит коннектор — недоступен отель.

Дефект, ради которого написан файл. Признак живости вёлся НА ОТЕЛЬ:

    liveness.observe(context.hotel.pk, False)     # в guest.py, по молчанию ОДНОЙ комнаты
    if liveness.endpoint_reachable(hotel.pk):     # читается на ВЕСЬ отель

Достаточно было одному гостю открыть номер, за которым нет оборудования, —
и весь отель проваливался в «недоступно» до следующего heartbeat, включая
исправные номера с живыми гостями. На стенде это ловится руками за минуту:
опрос комнаты 412 гасил рабочую 305.

Разделение проходит по тому, ЧЕЙ это факт:

  * «канал до объекта не отвечает» — факт отеля, его сообщает коннектор своим
    heartbeat, и он законно гасит весь отель;
  * «устройство комнаты не отвечает» — факт КОМНАТЫ, его выясняет чтение, и
    распространять его на соседей нельзя: у них своё устройство.
"""

from __future__ import annotations

import time

import pytest

from apps.core.context import tenant_context
from apps.grms.services import commands, liveness
from apps.grms.models import RoomType, RoomTypeRoom
from apps.hotels.models import Room
from tests.grms.grms_harness import GuestClient, _session

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

# Комната, которую эмулятор знает (см. DEFAULT_ROOMS), и та, что рядом.
LIVE_ROOM = "305"
NEIGHBOUR_ROOM = "301"


def _bind(hotel, number: str) -> Room:
    """Привязать комнату к демо-типу — иначе управлять в ней нечем."""
    with tenant_context(hotel):
        room = Room.objects.filter(number=number).first()
        assert room is not None, f"в демо-отеле нет комнаты {number}"
        RoomTypeRoom.objects.update_or_create(
            room=room, defaults={"room_type": RoomType.objects.get(code="demo-suite")}
        )
        return room


def _state(guest) -> dict:
    return guest.get("/api/v1/guest/room/state").json()


def _silence_one_room(monkeypatch, silent_number: str) -> None:
    """
    Замолчать ровно одно устройство. Остальные читаются как ни в чём не бывало —
    в этом вся проверка: отказ обязан остаться там, где он произошёл.
    """
    from apps.grms.transport import adapter

    real = commands.read_many

    def selective(hotel, *, device, feedbacks, **kwargs):
        if device.endswith(silent_number):
            return {fb: adapter.IridiResult(ok=False, error="timeout") for fb in feedbacks}
        return real(hotel, device=device, feedbacks=feedbacks, **kwargs)

    monkeypatch.setattr(commands, "read_many", selective)


def test_a_silent_room_does_not_take_the_hotel_down(client, crystal, stand, monkeypatch):
    """
    УКУС ПУНКТА 3. Опрашиваем МЁРТВУЮ комнату до подтверждённого молчания,
    затем открываем СОСЕДНЮЮ — она обязана остаться живой.

    Порядок здесь и есть проверка: сначала роняем одну, потом смотрим на
    другую. При общем на отель признаке живости вторая приходила
    «недоступна» с пустыми зонами, хотя её собственное устройство отвечало.
    """
    _bind(crystal, NEIGHBOUR_ROOM)
    liveness.forget(crystal.pk)
    _silence_one_room(monkeypatch, NEIGHBOUR_ROOM)

    dead = GuestClient(client, crystal, _session(client, crystal, room=NEIGHBOUR_ROOM))

    first = _state(dead)
    assert first["availability"] == "unavailable"
    assert first["unavailable_kind"] == "reading", "первое молчание — ещё не приговор"

    # Доводим до подтверждённого молчания: пауза длиннее окна схлопывания,
    # иначе второе чтение вернуло бы прежний ответ, не сходив к железу.
    time.sleep(commands.READ_COALESCE_S + 0.1)
    second = _state(dead)
    assert second["availability"] == "unavailable"
    assert second["unavailable_kind"] == "offline", "подтверждённое молчание — отказ"

    # А теперь главное: сосед.
    alive = GuestClient(client, crystal, _session(client, crystal, room=LIVE_ROOM))
    payload = _state(alive)

    assert payload["availability"] == "online", (
        "исправная комната ушла в «недоступно» из-за соседней — признак живости "
        "снова ведётся на отель, а не на комнату"
    )
    values = [c.get("value") for z in payload["zones"] for c in z["controls"]]
    assert [v for v in values if v is not None], "у живой комнаты значения есть"


def test_a_silent_room_does_not_poison_the_hotel_wide_flag(
    client, crystal, stand, monkeypatch
):
    """
    То же самое, но на уровне самого признака, а не ответа API.

    Отдельно от предыдущего, потому что тот проверяет СЛЕДСТВИЕ, а этот —
    ПРИЧИНУ: чтение комнаты не имеет права записывать «endpoint недоступен»,
    это утверждение про весь объект, и делать его вправе только коннектор.
    """
    _bind(crystal, NEIGHBOUR_ROOM)
    liveness.forget(crystal.pk)
    _silence_one_room(monkeypatch, NEIGHBOUR_ROOM)

    dead = GuestClient(client, crystal, _session(client, crystal, room=NEIGHBOUR_ROOM))
    _state(dead)
    time.sleep(commands.READ_COALESCE_S + 0.1)
    _state(dead)

    assert liveness.endpoint_reachable(crystal.pk) is not False, (
        "молчание одной комнаты записалось в признак живости ОТЕЛЯ — "
        "следующий опрос любой другой комнаты получит отказ, не сходив к железу"
    )


def test_a_dead_connector_still_takes_the_whole_hotel_down(guest, crystal, stand):
    """
    ОБРАТНАЯ СТОРОНА, и без неё разделение было бы половинчатым.

    Разводя комнату и отель, легко перестараться и сделать отель неспособным
    погаснуть целиком. Но «коннектора нет» — это именно факт отеля: за ним
    нет ни одной комнаты, и показывать их живыми нельзя.
    """
    from apps.hotels.models import OnPremNode

    with tenant_context(crystal):
        OnPremNode.objects.all().update(last_seen_at=None)

    payload = _state(guest)
    assert payload["availability"] == "unavailable"
    assert payload["unavailable_kind"] == "offline"
    # Состав номера показываем, состояние — нет.
    assert not [
        c for z in payload["zones"] for c in z["controls"] if c["value"] is not None
    ]
