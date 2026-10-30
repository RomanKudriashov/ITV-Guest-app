"""
РЕЖИМ КОНДИЦИОНЕРА, ПРАЧЕЧНАЯ, SOS (партия 65).

Каналы есть в ПНР Сиалии (C_FCU_Mode 0: «0 -Cold, 1 - Heat, 2 - Fan»; C_WAIT;
C_SOS) и на iRidi объекта PWV — режимы переключаются, проверено 30.10. В
каталоге их не было (решение 24.10 «к демо не делаем»), теперь они есть.
"""

from __future__ import annotations

import pytest

from apps.core.errors import ValidationError
from apps.grms.services import catalog
from apps.grms.services.guest import _ranges_for, _validate_value
from apps.grms.transport.emulator import DEVICE_TEMPLATE, IridiEmulator


def test_sialia_mode_table_from_description():
    assert catalog.parse_modes("0 -Cold, 1 - Heat, 2 - Fan") == [
        {"value": 0, "mode": "cool"},
        {"value": 1, "mode": "heat"},
        {"value": 2, "mode": "fan"},
    ]
    assert catalog.parse_modes("0 - Fan, 1 - Охлаждение, 2 - Нагрев, 3 - Авто") == [
        {"value": 0, "mode": "fan"},
        {"value": 1, "mode": "cool"},
        {"value": 2, "mode": "heat"},
        {"value": 3, "mode": "auto"},
    ]


def test_no_description_falls_back_to_bittel_convention():
    for text in ("", "0-2", "режим фанкойла", "1 - Cold"):
        assert catalog.parse_modes(text) == catalog.DEFAULT_MODES, text


def test_bite_mode_outside_the_table_is_refused():
    control = {"range": {"mode": {"min": 0, "max": 3, "kind": "enum", "modes": catalog.parse_modes("0 -Cold, 1 - Heat, 2 - Fan")}}}
    assert _validate_value(control, "mode", 2) == 2
    # 3 в диапазоне 0–3, но режима «3» в таблице нет: iRidi принял бы и молча отбросил.
    with pytest.raises(ValidationError):
        _validate_value(control, "mode", 3)


def test_guest_gets_the_mode_table():
    exposed = _ranges_for(["toggle", "mode"], {"mode": {"min": 0, "max": 2, "kind": "enum", "modes": catalog.DEFAULT_MODES}})
    assert exposed["mode"]["modes"][2] == {"value": 2, "mode": "fan"}


def test_new_kinds_and_capability_in_catalog():
    assert "mode" in catalog.ELEMENTS["air_conditioner"].optional
    assert catalog.ELEMENTS["laundry"].required == ("toggle",) and catalog.ELEMENTS["laundry"].icon == "laundry"
    assert catalog.ELEMENTS["sos"].required == ("toggle",) and catalog.ELEMENTS["sos"].icon == "sos"
    assert catalog.CAPABILITIES["mode"].value_kind == catalog.ValueKind.ENUM


def test_emulator_sialia_rooms_have_mode_fan_by_default_and_wait_sos():
    emulator = IridiEmulator(latency_range=(0.0, 0.0))
    for room in ("S202", "S204", "S101"):
        device = DEVICE_TEMPLATE.format(room=room)
        assert emulator.get_value(device, "F_FCU_Mode 0")[1] == "2", "по умолчанию — вентилятор"
        assert emulator.get_value(device, "F_WAIT")[1] == "0" and emulator.get_value(device, "F_SOS")[1] == "0"
    device = DEVICE_TEMPLATE.format(room="S101")
    emulator.set_value(device, "C_FCU_Mode 0", 0)
    assert emulator.get_value(device, "F_FCU_Mode 0")[1] == "0"


def test_sos_asks_before_calling_and_others_do_not():
    from apps.grms.services.guest import _serialize_control

    sos = {"controlId": "sos.x", "kind": "sos", "capabilities": ["toggle"], "channels": {}, "confirm": catalog.ELEMENTS["sos"].confirm}
    dnd = {"controlId": "dnd.x", "kind": "dnd", "capabilities": ["toggle"], "channels": {}, "confirm": catalog.ELEMENTS["dnd"].confirm}
    assert _serialize_control(sos, {}, busy={}, language="en")["confirm"].startswith("Call for help")
    assert _serialize_control(dnd, {}, busy={}, language="ru")["confirm"] == ""


def test_mode_with_typo_range_in_pnr_is_checked_by_table_only():
    """ПНР Сиалии: у C_FCU_Mode диапазон «16-33» (опечатка), режимы 0/1/2."""
    control = {"range": {"mode": {"min": 16, "max": 33, "kind": "range", "modes": catalog.parse_modes("0 -Cold, 1 - Heat, 2 - Fan")}}}
    assert _validate_value(control, "mode", 0) == 0
    with pytest.raises(ValidationError):
        _validate_value(control, "mode", 20)
