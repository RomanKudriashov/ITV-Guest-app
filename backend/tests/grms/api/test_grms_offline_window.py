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

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.grms.services import liveness
from apps.hotels.models import OnPremNode

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


def _connector_dies(stand, hotel):
    """
    Коннектор упал, но отметка ещё свежая — то самое окно.

    Останавливаем ТРАНСПОРТ, а `last_seen_at` намеренно оставляем сегодняшним:
    в этом и весь смысл проверки.

    Кэш чистим целиком. В нём две вещи, и обе мешают: признак живости (его
    наполнил heartbeat, которого больше не будет) и схлопывание одинаковых
    чтений на 1,5 секунды — без сброса второй опрос в тесте вернул бы пачку,
    прочитанную ДО падения, и проверка доказывала бы обратное тому, что
    написано в её имени.
    """
    from django.core.cache import cache

    stand["connector"].stop()
    with tenant_context(hotel):
        OnPremNode.objects.all().update(last_seen_at=timezone.now())
    cache.clear()


def test_dead_transport_with_a_fresh_heartbeat_is_unavailable(guest, crystal, stand):
    """Связи нет — значит недоступно, даже пока узел числится живым."""
    _connector_dies(stand, crystal)

    payload = guest.get("/api/v1/guest/room/state").json()

    assert payload["availability"] == "unavailable"
    assert payload["zones"] == [], "элементы без связи не имеют состояния"
    assert payload["can_command"] is False, "недоступному оборудованию не скомандуешь"
    # Гостю — нейтральный текст, техническая причина остаётся в логе.
    assert "ресепшен" in payload["message"]
    assert "UNREADABLE" not in payload["message"]


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

    Первый опрос состояния записывает выясненное в признак живости, и команда
    после него получает честный отказ вместо `202 pending`.
    """
    _connector_dies(stand, crystal)
    guest.get("/api/v1/guest/room/state")

    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "room_unavailable"


def test_a_failed_read_is_remembered_so_the_next_poll_is_not_paid_for_twice(
    guest, crystal, stand
):
    """
    Выясненное опытом попадает в признак живости.

    Иначе каждый опрос в окне заново отстаивает таймауты по всем каналам — на
    стенде это ровно три секунды на запрос, и платятся они за ответ, который
    уже известен.
    """
    _connector_dies(stand, crystal)
    assert liveness.endpoint_reachable(crystal.pk) is None, "до опроса знать неоткуда"

    guest.get("/api/v1/guest/room/state")

    assert liveness.endpoint_reachable(crystal.pk) is False


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
    from django.core.cache import cache

    from apps.grms.services import commands
    from apps.grms.transport import adapter

    def all_reads_fail(hotel, *, device, feedbacks, **kwargs):
        return {fb: adapter.IridiResult(ok=False, error="timeout") for fb in feedbacks}

    monkeypatch.setattr(commands, "read_many", all_reads_fail)
    cache.clear()
    assert guest.get("/api/v1/guest/room/state").json()["availability"] == "unavailable"
    assert liveness.endpoint_reachable(crystal.pk) is False

    monkeypatch.undo()
    cache.clear()

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["availability"] == "online"
    assert payload["zones"]
    assert payload["can_command"] is True
    assert liveness.endpoint_reachable(crystal.pk) is True


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
