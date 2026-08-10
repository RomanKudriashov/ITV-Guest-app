"""
СТОРОЖ: сцена демо-оборудования ОТЫГРЫВАЕТСЯ, а не проглатывается.

Найдено на живом телефоне: гость жмёт «Ночь», экран отвечает «оборудование
приняло команду», и ничего не меняется — свет горит, шторы стоят, уставка та
же. Причина была в эмуляторе: канал сцены лежал во множестве «без feedback», и
`set_value` возвращал True, не тронув ни одного канала.

На объекте сцену отрабатывает контроллер: он сам раскладывает свет, шторы и
климат. Демо-оборудование обязано вести себя так же, иначе демо показывает
поломку там, где её нет.

Проверяется ровно два свойства, и второе не менее важно первого:
  * нажатие сцены МЕНЯЕТ каналы света, штор и климата;
  * у самой сцены feedback'а по-прежнему НЕТ — подтверждать её нечем, и
    показывать «включённой» гостю нечему.
"""

import pytest

from apps.grms.transport.emulator import (
    DEVICE_TEMPLATE,
    ROOM_PROFILES,
    SCENE_PRESETS,
    IridiEmulator,
)

DEMO_ROOM = "305"


@pytest.fixture
def emulator() -> IridiEmulator:
    # Без задержки: здесь проверяется ЧТО меняется, а не как оно доезжает.
    # Разброс задержки живёт в своих тестах.
    return IridiEmulator(latency_range=(0.0, 0.0))


def _device(room: str = DEMO_ROOM) -> str:
    return DEVICE_TEMPLATE.format(room=room)


def _read(emulator: IridiEmulator, device: str, tag: str) -> str | None:
    return emulator.get_value(device, f"F_{tag}")[1]


def test_scene_moves_light_curtains_and_climate(emulator: IridiEmulator):
    device = _device()
    before = {
        tag: _read(emulator, device, tag)
        for tag in ("Light 1", "Curtain 1", "FCU_Setpoint 1")
    }

    assert emulator.set_value(device, "C_Scene_2", 1) is True

    after = {tag: _read(emulator, device, tag) for tag in before}
    assert after != before, "сцена принята, но номер не изменился"
    # «Утро» из набора демо-номера: гостиная зажглась, штора открылась, теплее.
    assert after["Light 1"] == "1"
    assert after["Curtain 1"] == "1"
    assert after["FCU_Setpoint 1"] == "23"


def test_scenes_differ_from_each_other(emulator: IridiEmulator):
    """Четыре сцены — четыре РАЗНЫХ номера, иначе выбор бессмыслен."""
    device = _device()
    seen: list[tuple[str, ...]] = []
    for index in range(1, ROOM_PROFILES[DEMO_ROOM]["scenes"] + 1):
        emulator.set_value(device, f"C_Scene_{index}", 1)
        seen.append(
            tuple(
                str(_read(emulator, device, tag))
                for tag in ("Light 1", "Light 2", "Light 3", "Curtain 1", "FCU_Setpoint 1")
            )
        )
    assert len(set(seen)) == len(seen), f"сцены дают одинаковый номер: {seen}"


def test_scene_itself_has_no_feedback(emulator: IridiEmulator):
    """
    Сцену нельзя показать «включённой»: F_Scene_* не существует на железе
    (прозвон §8.3). Отыгрыш этого не меняет — иначе гость увидел бы
    подтверждение там, где подтверждать нечем.
    """
    device = _device()
    emulator.set_value(device, "C_Scene_1", 1)
    found, value = emulator.get_value(device, "F_Scene_1")
    assert found is True and value is None


def test_scene_off_does_nothing(emulator: IridiEmulator):
    """
    Сцена — это триггер, а не тумблер: её «выключение» не событие. Нулём по
    каналу сцены раскладку не меняют.
    """
    device = _device()
    emulator.set_value(device, "C_Scene_2", 1)
    lit = _read(emulator, device, "Light 1")
    assert emulator.set_value(device, "C_Scene_2", 0) is True
    assert _read(emulator, device, "Light 1") == lit


def test_room_without_preset_still_plays_something(emulator: IridiEmulator):
    """
    Комнаты с боевого стенда явных наборов не имеют. Нажатие сцены и там
    обязано быть ВИДНО: молчание читается как поломка одинаково в любом номере.
    """
    room = "701"
    assert room not in SCENE_PRESETS
    device = _device(room)
    before = _read(emulator, device, "Light 1")
    emulator.set_value(device, "C_Scene_2", 1)
    assert _read(emulator, device, "Light 1") != before
