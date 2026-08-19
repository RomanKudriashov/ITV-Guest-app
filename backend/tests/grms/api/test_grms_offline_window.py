"""
Окно между смертью коннектора и порогом heartbeat.

Дефект, ради которого написан файл. «Узел жив» = отмечался за последние
`OFFLINE_AFTER_SECONDS` (три минуты). Коннектор падает — отметка остаётся
свежей, и до трёх минут узел ЧИСЛИТСЯ живым, потому что три минуты назад он
и был живым. В этом окне единственный, кто знает правду, — попытка чтения:
она не проходит. Прежний код этот ответ выбрасывал:

    successful = [r for r in results.values() if r.ok]
    dead = bool(successful) and all(r.is_dead_sentinel for r in successful)

Связи нет → `successful` пуст → `dead` False → «состояние прочитано». Гость
получал `availability: online`, шесть зон и ноль значений — рабочий с виду
экран номера, на котором ничего не работает.

Проверяется именно ОКНО: узел с ЖИВОЙ отметкой и мёртвым транспортом. Тест
на «узел не отмечался ни разу» уже есть (test_grms_guest_api.py) и ловил
другое — путь, который и так работал.
"""

from __future__ import annotations

import time

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.grms.services import commands, liveness
from apps.grms.management.commands.seed_grms_demo import DEMO_ROOM
from apps.hotels.models import OnPremNode, Room

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


def _connector_dies(stand, hotel):
    """
    Коннектор упал, но отметка ещё свежая — то самое окно.

    Останавливаем ТРАНСПОРТ, а `last_seen_at` намеренно оставляем сегодняшним:
    в этом и весь смысл проверки.

    Мешают две вещи, и обе снимаются ТОЧЕЧНО, без `cache.clear()`.

    Чистить кэш целиком здесь нельзя, хотя соблазн есть: у Redis это FLUSHDB,
    а базу `/5` делят все четыре процесса прогона (см. `_clean_cache` в
    tests/conftest.py — она отделяет тесты от dev-стенда, но не воркеры друг
    от друга). Один такой вызов посреди теста роняет соседа в другом
    процессе: так у меня развалился `test_wrong_pin_counts_down_and_then_blocks`,
    которому вымыло счётчики попыток на середине.

    Поэтому: признак живости убираем по ключу, а схлопывание одинаковых
    чтений (1,5 с) пережидаем — оно живёт по TTL и чужих ключей не трогает.
    """
    stand["connector"].stop()
    with tenant_context(hotel):
        OnPremNode.objects.all().update(last_seen_at=timezone.now())
    liveness.forget(hotel.pk)
    time.sleep(commands.READ_COALESCE_S + 0.1)


def test_dead_transport_with_a_fresh_heartbeat_is_unavailable(guest, crystal, stand):
    """
    Связи нет — значит недоступно, даже пока узел числится живым.

    НО НЕ С ПЕРВОГО ЧТЕНИЯ. Одно молчание неотличимо от коннектора, который
    поднялся секунду назад и ещё не отдал значения: узел живой, endpoint про
    себя не сообщал, канал молчит. Поэтому первый ответ — «читаем состояние»
    и повтор, и только подтверждённое молчание становится отказом с
    ресепшеном. Раньше отказ выдавался сразу, и гость шёл вниз из-за задержки,
    которая прошла бы сама.
    """
    _connector_dies(stand, crystal)

    first = guest.get("/api/v1/guest/room/state").json()
    assert first["availability"] == "unavailable"
    assert first["zones"] == [], "элементы без связи не имеют состояния"
    assert first["can_command"] is False, "недоступному оборудованию не скомандуешь"
    assert first["unavailable_kind"] == "reading", "первое молчание — ещё не приговор"
    assert "ресепшен" not in first["message"], "рано отправлять гостя вниз"

    # Ждём дольше окна схлопывания: иначе повтор получил бы прежний ответ, не
    # сходив к оборудованию, и «подтверждением» это считать было бы нельзя.
    time.sleep(commands.READ_COALESCE_S + 0.1)
    second = guest.get("/api/v1/guest/room/state").json()

    assert second["availability"] == "unavailable"
    assert second["zones"] == []
    assert second["can_command"] is False
    assert second["unavailable_kind"] == "offline"
    # Гостю — нейтральный текст, техническая причина остаётся в логе.
    assert "ресепшен" in second["message"]
    assert "UNREADABLE" not in second["message"]


def test_no_values_leak_through_the_window(guest, crystal, stand):
    """
    Ни одного значения: ни старого, ни нулевого.

    Пустые зоны — это не «мелочь оформления»: элемент со значением `0` гость
    читает как «выключено», а не как «неизвестно», и идёт включать свет,
    который на самом деле горит.
    """
    live = guest.get("/api/v1/guest/room/state").json()
    assert any(
        control.get("value") is not None
        for zone in live["zones"]
        for control in zone["controls"]
    ), "до падения значения были — иначе проверка ничего не значит"

    _connector_dies(stand, crystal)

    payload = guest.get("/api/v1/guest/room/state").json()
    values = [c.get("value") for z in payload["zones"] for c in z["controls"]]
    assert values == []


def test_command_in_the_window_is_refused_not_accepted(guest, crystal, stand):
    """
    Команда отклоняется, а не принимается в никуда.

    Выясненное записывается в признак живости не с первого молчания, а с
    ПОДТВЕРЖДЁННОГО: два опроса, между ними — окно схлопывания, чтобы второй
    действительно сходил к оборудованию. После этого команда получает честный
    отказ вместо `202 pending`.
    """
    _connector_dies(stand, crystal)
    guest.get("/api/v1/guest/room/state")
    time.sleep(commands.READ_COALESCE_S + 0.1)
    guest.get("/api/v1/guest/room/state")

    # Отказ приходит по признаку МОЛЧАЩЕЙ КОМНАТЫ: канал до объекта формально
    # ещё числится живым (heartbeat свежий), и без этой проверки команда ушла
    # бы в воркер, чтобы через несколько секунд вернуться исходом `failed`.
    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "room_unavailable"


def test_a_failed_read_is_remembered_so_the_next_poll_is_not_paid_for_twice(
    guest, crystal, stand
):
    """
    Выясненное опытом запоминается — но ПРО КОМНАТУ, а не про отель.

    Иначе каждый опрос заново отстаивает таймауты по всем каналам: на стенде
    это ровно три секунды на запрос, и платятся они за ответ, который уже
    известен. Раньше экономия достигалась порчей общего признака живости, и
    ценой ей был весь отель, погашенный одной мёртвой комнатой.

    Теперь проверяется то же свойство и там, где ему место: комната признана
    молчащей, повторное чтение к железу НЕ идёт, а признак отеля чист.
    """
    _connector_dies(stand, crystal)
    assert liveness.endpoint_reachable(crystal.pk) is None, "до опроса знать неоткуда"

    guest.get("/api/v1/guest/room/state")
    assert (
        liveness.endpoint_reachable(crystal.pk) is None
    ), "по ОДНОМУ молчанию ничего решать нельзя — повтор превратился бы в бутафорию"

    time.sleep(commands.READ_COALESCE_S + 0.1)
    guest.get("/api/v1/guest/room/state")

    with tenant_context(crystal):
        room = Room.objects.get(number=DEMO_ROOM)
    assert liveness.room_is_silent(
        crystal.pk, room.pk, attempts=2, coalesce_s=commands.READ_COALESCE_S
    ), "молчание комнаты не запомнилось — следующий опрос снова отстоит все таймауты"
    assert liveness.endpoint_reachable(crystal.pk) is not False, (
        "молчание комнаты записалось в признак ОТЕЛЯ — соседние номера погаснут вместе с ней"
    )


def test_recovery_returns_the_room(guest, crystal, monkeypatch):
    """
    Связь вернулась — вернулись и зоны со значениями.

    Признак живости не должен «залипать» на отказе: он переписывается первым
    же удачным чтением.

    Связь рвём подменой чтения, а не остановкой оснастки: поток коннектора
    в тесте одноразовый, `stop()` его хоронит, и «поднять обратно» после него
    нечего. Подмена снимается — и это ровно то восстановление, которое надо
    проверить.
    """
    from apps.grms.transport import adapter

    def all_reads_fail(hotel, *, device, feedbacks, **kwargs):
        return {fb: adapter.IridiResult(ok=False, error="timeout") for fb in feedbacks}

    # Подмена идёт МИМО схлопывания (оно внутри `read_many`), поэтому здесь
    # достаточно снять признак живости — пережидать нечего.
    monkeypatch.setattr(commands, "read_many", all_reads_fail)
    liveness.forget(crystal.pk)
    # Два молчания и пауза между ними: отказ объявляется по подтверждённому
    # молчанию, а не по первому.
    assert guest.get("/api/v1/guest/room/state").json()["availability"] == "unavailable"
    time.sleep(commands.READ_COALESCE_S + 0.1)
    assert guest.get("/api/v1/guest/room/state").json()["availability"] == "unavailable"
    with tenant_context(crystal):
        room = Room.objects.get(number=DEMO_ROOM)
    assert liveness.room_is_silent(
        crystal.pk, room.pk, attempts=2, coalesce_s=commands.READ_COALESCE_S
    )

    monkeypatch.undo()
    liveness.forget(crystal.pk)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["availability"] == "online"
    assert payload["zones"]
    assert payload["can_command"] is True
    assert liveness.endpoint_reachable(crystal.pk) is True
    with tenant_context(crystal):
        room = Room.objects.get(number=DEMO_ROOM)
    assert not liveness.room_is_silent(
        crystal.pk, room.pk, attempts=2, coalesce_s=commands.READ_COALESCE_S
    ), "комната прочиталась — признак молчания обязан сняться"


# --- Укус: что этот фикс НЕ должен был поменять ----------------------------


def test_a_live_room_stays_online(guest):
    """
    УКУС. Самый дешёвый способ «починить» недоступность — объявлять её чаще,
    чем надо. Живая комната обязана остаться живой: зоны, значения и право
    командовать на месте.
    """
    payload = guest.get("/api/v1/guest/room/state").json()

    assert payload["availability"] == "online"
    assert payload["can_command"] is True
    values = [c.get("value") for z in payload["zones"] for c in z["controls"]]
    assert [v for v in values if v is not None], "у живой комнаты значения есть"


def test_the_plan_survives_unavailability(guest, crystal, stand):
    """
    УКУС. План — КОНФИГУРАЦИЯ, а не состояние: разметка комнаты не перестаёт
    быть верной оттого, что каналы молчат. Новая ветка недоступности не должна
    была его унести вместе с зонами.
    """
    _connector_dies(stand, crystal)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["availability"] == "unavailable"
    assert payload["plan"]["zones"], "план остаётся и в недоступности"


def test_trust_is_still_reported_when_unavailable(guest, crystal, stand):
    """
    УКУС. `can_command` погашен из-за оборудования, но уровень доверия — это
    другой вопрос, и подменять его отказом нельзя: он показывается гостю и
    решает, спрашивать ли PIN, когда связь вернётся.
    """
    live_trust = guest.get("/api/v1/guest/room/state").json()["trust"]
    _connector_dies(stand, crystal)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["trust"] == live_trust
