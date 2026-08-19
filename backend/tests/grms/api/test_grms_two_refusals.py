"""
Два «нельзя» в управлении номером — и они разные.

«Гость не подтвердился» и «оборудование не отвечает» — это разные отказы,
которые лечатся разным: первый лечит PIN в руках гостя, второй — ресепшен.
Пока в снимке жило одно поле `can_command`, экран читал по нему обе вещи
сразу, и получался укус, ради которого написан файл:

    гость вводит ВЕРНЫЙ PIN → в этот момент оборудование молчит →
    снимок приезжает с `can_command: false` → экран показывает замок заново.

Подтверждение при этом на сервере есть. Гость видит форму PIN, вводит тот же
код второй раз, получает тот же замок — и уходит на ресепшен с жалобой на код,
который на самом деле подошёл.

Здесь проверяется, что полей два, что они независимы и что вид недоступности
отвечает на вопрос «что мне делать», а не «что технически случилось».
"""

from __future__ import annotations

import time

import pytest

from apps.core.context import tenant_context
from apps.grms.services import commands, guest as room_guest, liveness
from apps.grms.management.commands.seed_grms_demo import DEMO_PIN
from apps.hotels.models import HotelModule
from tests.grms.grms_harness import GuestClient, _session

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


# --- Оснастка ---------------------------------------------------------------


def _demo_entry(hotel, enabled: bool) -> None:
    with tenant_context(hotel):
        module = HotelModule.objects.get(code=HotelModule.Code.ROOM_CONTROL)
        config = dict(module.config or {})
        config["guest_entry_demo"] = enabled
        module.config = config
        module.save(update_fields=["config", "updated_at"])


def _silence_equipment(monkeypatch) -> None:
    """Оборудование молчит: ни один канал не отвечает."""
    from apps.grms.transport import adapter

    def all_reads_fail(hotel, *, device, feedbacks, **kwargs):
        return {fb: adapter.IridiResult(ok=False, error="timeout") for fb in feedbacks}

    monkeypatch.setattr(commands, "read_many", all_reads_fail)


def _state(guest) -> dict:
    return guest.get("/api/v1/guest/room/state").json()


def _proven_silence(guest, hotel) -> dict:
    """
    Довести молчание до ПОДТВЕРЖДЁННОГО: два чтения с паузой длиннее окна
    схлопывания, иначе второе вернуло бы прежний ответ, не сходив к железу.
    """
    _state(guest)
    time.sleep(commands.READ_COALESCE_S + 0.1)
    return _state(guest)


# --- Петля: два поля, четыре клетки -----------------------------------------


@pytest.mark.parametrize(
    "verified, equipment_alive, expect_verified, expect_can_command",
    [
        # гость не подтвердился, железо живо → командовать нельзя, но замок
        # висит из-за ДОВЕРИЯ, и плашки недоступности быть не должно
        (False, True, False, False),
        # подтвердился, железо живо → можно всё
        (True, True, True, True),
        # ВОТ ЭТА КЛЕТКА И ЕСТЬ УКУС: подтверждение есть, а команду отдать
        # некому. Слитый флаг здесь врёт про доверие и возвращает гостю замок.
        (True, False, True, False),
        # не подтвердился и железо молчит → нельзя по обеим причинам сразу
        (False, False, False, False),
    ],
)
def test_the_two_flags_are_independent(
    client, crystal, stand, monkeypatch, verified, equipment_alive, expect_verified, expect_can_command
):
    """
    УКУС НА ПЕТЛЕ. Четыре клетки матрицы «доверие × оборудование».

    Если кто-нибудь вернёт слитый флаг — сделает `room_verified` равным
    `can_command` или наоборот, — красной станет третья клетка: подтверждённый
    гость при молчащем оборудовании. Именно она и была сломана, и именно её
    нельзя доказать ни одной клеткой по отдельности: в трёх остальных оба
    поля совпадают, и слитая версия проходит их все.
    """
    _demo_entry(crystal, False)
    guest = GuestClient(client, crystal, _session(client, crystal))

    if verified:
        assert guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN}).status_code == 200

    if equipment_alive:
        payload = _state(guest)
    else:
        _silence_equipment(monkeypatch)
        liveness.forget(crystal.pk)
        payload = _proven_silence(guest, crystal)

    assert payload["room_verified"] is expect_verified, "поле про ДОВЕРИЕ"
    assert payload["can_command"] is expect_can_command, "поле про ОБОРУДОВАНИЕ"


def test_a_verified_guest_keeps_the_confirmation_while_the_room_is_silent(
    client, crystal, stand, monkeypatch
):
    """
    УКУС. Верный PIN при молчащем оборудовании — подтверждение НЕ отзывается.

    Проверяется именно то, что видит экран: `room_verified` остаётся истиной,
    и значит замок обратно не возвращается. Отдельно от петли, потому что
    здесь важен ПОРЯДОК: сначала подтвердились на живом железе, потом железо
    замолчало — и подтверждение это пережило.
    """
    _demo_entry(crystal, False)
    guest = GuestClient(client, crystal, _session(client, crystal))

    assert _state(guest)["room_verified"] is False, "до PIN подтверждения нет"
    assert guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN}).status_code == 200
    assert _state(guest)["room_verified"] is True

    _silence_equipment(monkeypatch)
    liveness.forget(crystal.pk)
    payload = _proven_silence(guest, crystal)

    assert payload["availability"] == "unavailable"
    assert payload["can_command"] is False, "молчащему железу не скомандуешь"
    assert payload["room_verified"] is True, (
        "подтверждение отозвано молчанием оборудования — гостю снова покажут замок, "
        "хотя PIN он ввёл верно"
    )


# --- Три состояния, три текста ----------------------------------------------


def test_a_cold_read_asks_to_wait_and_not_to_go_downstairs(
    client, crystal, stand, monkeypatch
):
    """
    Первое молчание — «читаем состояние», а не отказ.

    Одно неотвеченное чтение неотличимо от коннектора, поднявшегося секунду
    назад: узел живой, endpoint про себя не сообщал, канал молчит. Отправлять
    гостя на ресепшен из-за задержки, которая пройдёт сама, — это лишний поход
    вниз по лестнице.
    """
    guest = GuestClient(client, crystal, _session(client, crystal))
    _silence_equipment(monkeypatch)
    liveness.forget(crystal.pk)

    first = _state(guest)
    assert first["availability"] == "unavailable"
    assert first["unavailable_kind"] == room_guest.UNAVAILABLE_READING
    assert "ресепшен" not in first["message"]
    assert "Читаем" in first["message"]


def test_confirmed_silence_is_an_honest_refusal(client, crystal, stand, monkeypatch):
    """Молчание, подтверждённое повтором, — уже отказ, и ресепшен тут к месту."""
    guest = GuestClient(client, crystal, _session(client, crystal))
    _silence_equipment(monkeypatch)
    liveness.forget(crystal.pk)

    payload = _proven_silence(guest, crystal)
    assert payload["unavailable_kind"] == room_guest.UNAVAILABLE_OFFLINE
    assert "ресепшен" in payload["message"]


def test_a_session_without_a_room_is_asked_for_the_room_number(client, crystal, stand):
    """
    Анонимная сессия без номера получала «обратитесь на ресепшен».

    Ресепшен тут ни при чём: ничего не сломано, гость просто не сказал, в
    каком он номере. Отправлять его вниз за этим — значит заставить человека
    решать задачу, которую он решает сам за две секунды.
    """
    from apps.accounts.models import GuestSession
    from tests.conftest import host_for

    token = _session(client, crystal)
    with tenant_context(crystal):
        GuestSession.objects.all().update(room=None, room_verified_at=None)

    payload = client.get(
        "/api/v1/guest/room/state",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()

    assert payload["availability"] == "unavailable"
    assert payload["unavailable_kind"] == room_guest.UNAVAILABLE_NO_ROOM
    assert "номер комнаты" in payload["message"]
    assert "ресепшен" not in payload["message"], "сломано ничего не было"
    assert payload["room_verified"] is False
    assert payload["can_command"] is False


def test_other_reasons_stay_neutral(client, crystal, stand):
    """
    УКУС. Разговорчивость — не бесплатная: чем больше видов недоступности, тем
    легче протащить наружу техническую причину. Комната без опубликованной
    конфигурации остаётся нейтральным отказом, а не отдельным откровением.
    """
    from apps.accounts.models import GuestSession
    from apps.hotels.models import Room
    from tests.conftest import host_for

    token = _session(client, crystal)
    with tenant_context(crystal):
        # Комната есть, а типа с опубликованной конфигурацией у неё нет.
        orphan = Room.objects.exclude(
            id__in=[link.room_id for link in _links(crystal)]
        ).first()
        assert orphan is not None, "нужна комната без привязки к типу"
        GuestSession.objects.all().update(room=orphan, room_verified_at=None)

    payload = client.get(
        "/api/v1/guest/room/state",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()

    assert payload["unavailable_kind"] == room_guest.UNAVAILABLE_OFFLINE
    assert "ресепшен" in payload["message"]
    for marker in ("NO_ROOM_TYPE", "NO_PUBLISHED_CONFIG", "STATE_UNREADABLE", "CONNECTOR"):
        assert marker not in payload["message"]


def _links(hotel):
    from apps.grms.models import RoomTypeRoom

    with tenant_context(hotel):
        return list(RoomTypeRoom.objects.all())
