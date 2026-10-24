"""
СКОРОСТИ ВЕНТИЛЯТОРА — ПО ТАБЛИЦЕ ОБЪЕКТА (партия 64-1).

У «Сиалии» 0 — низкая, 4 — авто; экран гостя считал 0 всегда «авто». Таблица
берётся из описания канала (приходит с импортом ПНР) и едет в снимок. Нет
таблицы — как раньше: «Кристалл» не меняется.
"""

from apps.grms.services import catalog
from apps.grms.services.guest import _ranges_for


def test_sialia_table_auto_first_then_low_to_high():
    assert catalog.parse_speeds("0 -Low, 1 - Med, 2 - High, 4 - Auto") == [
        {"value": 4, "auto": True},
        {"value": 0, "auto": False},
        {"value": 1, "auto": False},
        {"value": 2, "auto": False},
    ]


def test_240701_table_gives_the_old_order():
    assert catalog.parse_speeds("0 -Auto, 1 - Low, 2 - Med, 3 - High") == [
        {"value": 0, "auto": True},
        {"value": 1, "auto": False},
        {"value": 2, "auto": False},
        {"value": 3, "auto": False},
    ]


def test_no_description_no_table():
    for text in ("", "0-3", "скорость фанкойла", "1 - Auto"):
        assert catalog.parse_speeds(text) is None, text


def test_bite_guest_gets_the_table_and_crystal_does_not():
    sialia = {"fan_speed": {"min": 0, "max": 4, "kind": "enum", "speeds": catalog.parse_speeds("0 -Low, 1 - Med, 2 - High, 4 - Auto")}}
    exposed = _ranges_for(["fan_speed"], sialia)
    assert exposed["fan_speed"]["speeds"][0] == {"value": 4, "auto": True}, "гость не получил таблицу скоростей"
    crystal = {"fan_speed": {"min": 0, "max": 3, "kind": "enum"}}
    assert "speeds" not in _ranges_for(["fan_speed"], crystal)["fan_speed"]
