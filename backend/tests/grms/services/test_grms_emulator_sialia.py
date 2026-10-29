"""
ЭМУЛЯТОР: ОТЕЛЬНЫЙ НОМЕР «СИАЛИИ» (партия 64-1).

Профиль повторяет её собственный ПНР («стандартный номер»): свет C_Light 0…7
(нумерация с нуля), одна штора, фанкойл с номером 0, DND/MUR и одна сцена
«Выключить всё» — добавлена для демо.

Укусы:
* устройства «Сиалии» свои («… S202») — свет у «Азура» в 202 не зажигается
  у «Сиалии» и наоборот;
* нумерация с нуля — только у «Сиалии»: профили «Кристалла» и объекта прежние;
* «Выключить всё» гасит все восемь групп и не трогает штору и климат.
"""

import pytest

from apps.grms.transport.emulator import DEVICE_TEMPLATE, IridiEmulator


@pytest.fixture
def emulator() -> IridiEmulator:
    return IridiEmulator(latency_range=(0.0, 0.0))


def _read(emulator: IridiEmulator, device: str, tag: str) -> str | None:
    return emulator.get_value(device, f"F_{tag}")[1]


SIALIA = DEVICE_TEMPLATE.format(room="S202")


def test_sialia_channels_follow_its_own_pnr(emulator: IridiEmulator):
    for i in range(8):
        assert _read(emulator, SIALIA, f"Light {i}") == "0", f"нет канала Light {i}"
    assert _read(emulator, SIALIA, "Light 8") is None, "лишняя девятая группа"
    assert _read(emulator, SIALIA, "Curtain 1") == "0"
    for tag in ("FCU_MainSw 0", "FCU_Speed 0", "FCU_Setpoint 0", "FCU_Temperature 0", "DND", "MUR"):
        assert _read(emulator, SIALIA, tag) is not None, tag
    assert _read(emulator, SIALIA, "FCU_MainSw 1") is None, "у «Сиалии» фанкойл с номером 0"


def test_bite_sialia_and_azure_do_not_share_a_device(emulator: IridiEmulator):
    azure = DEVICE_TEMPLATE.format(room="202")
    assert emulator.set_value(SIALIA, "C_Light 1", 1) is True
    assert _read(emulator, SIALIA, "Light 1") == "1"
    assert _read(emulator, azure, "Light 1") == "0", "свет «Сиалии» зажёгся у «Азура»"


def test_bite_zero_numbering_only_for_sialia(emulator: IridiEmulator):
    crystal = DEVICE_TEMPLATE.format(room="305")
    assert _read(emulator, crystal, "Light 1") is not None
    assert _read(emulator, crystal, "Light 0") is None, "нумерация с нуля утекла в «Кристалл»"
    assert _read(emulator, DEVICE_TEMPLATE.format(room="701"), "Light 12") is not None, "профиль объекта изменился"


def test_all_off_scene_switches_off_lights_only(emulator: IridiEmulator):
    for i in range(8):
        emulator.set_value(SIALIA, f"C_Light {i}", 1)
    emulator.set_value(SIALIA, "C_Curtain 1", 1)
    emulator.set_value(SIALIA, "C_FCU_MainSw 0", 1)
    assert emulator.set_value(SIALIA, "C_Scene_1", 1) is True
    assert all(_read(emulator, SIALIA, f"Light {i}") == "0" for i in range(8)), "свет не погас"
    assert _read(emulator, SIALIA, "Curtain 1") == "1", "«Выключить всё» тронуло штору"
    assert _read(emulator, SIALIA, "FCU_MainSw 0") == "1", "«Выключить всё» тронуло климат"
    # У сцены feedback'а нет — как на объекте.
    assert _read(emulator, SIALIA, "Scene_1") is None


def test_every_sialia_hotel_room_has_its_device(emulator: IridiEmulator):
    for room in ("S1101", "S1306", "S1506"):
        assert _read(emulator, DEVICE_TEMPLATE.format(room=room), "Light 0") == "0", room


RESIDENCE = DEVICE_TEMPLATE.format(room="S204")


def test_residence_has_ten_groups_and_its_own_device(emulator: IridiEmulator):
    assert [_read(emulator, RESIDENCE, f"Light {i}") for i in range(10)] == ["0"] * 10
    assert _read(emulator, RESIDENCE, "Light 10") is None
    assert _read(emulator, DEVICE_TEMPLATE.format(room="S1107"), "Light 9") == "0"
    # 204 — свой: у «Азура» 204 и у отельного номера 202 профиль прежний.
    emulator.set_value(RESIDENCE, "C_Light 9", 1)
    assert _read(emulator, RESIDENCE, "Light 9") == "1"
    assert _read(emulator, DEVICE_TEMPLATE.format(room="204"), "Light 9") is None
    assert _read(emulator, SIALIA, "Light 8") is None, "профиль 202 изменился"


def test_residence_all_off_covers_ten_groups(emulator: IridiEmulator):
    for i in range(10):
        emulator.set_value(RESIDENCE, f"C_Light {i}", 1)
    emulator.set_value(RESIDENCE, "C_Scene_1", 1)
    assert all(_read(emulator, RESIDENCE, f"Light {i}") == "0" for i in range(10))


def test_showroom_residence_101_has_ten_groups_and_its_own_state(emulator: IridiEmulator):
    """Номер 101 (шоурум «Резиденция», партия 65) — свой профиль резиденции и своё состояние."""
    showroom = DEVICE_TEMPLATE.format(room="S101")
    assert [_read(emulator, showroom, f"Light {i}") for i in range(10)] == ["0"] * 10
    assert _read(emulator, showroom, "Light 10") is None
    emulator.set_value(showroom, "C_Light 4", 1)
    assert _read(emulator, showroom, "Light 4") == "1"
    assert _read(emulator, RESIDENCE, "Light 4") == "0", "101 и 204 делят состояние"
