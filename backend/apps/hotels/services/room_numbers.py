"""
КАК ЧИТАТЬ НОМЕР КОМНАТЫ (партия 63-1).

Этаж и позицию на этаже (стояк) у большинства отелей можно прочесть из
номера: «2205» — второй этаж, позиция 05; номера с одинаковой позицией стоят
друг под другом и обычно одинаковы внутри. Правило — настройка отеля
(`Hotel.settings["room_numbers"]`), по умолчанию: позиция — последние две
цифры, этаж — всё, что перед ней.

Что сильнее правила:
* этаж, заданный у номера (`Room.floor`), — правило заполняет только пустой;
* позиция, заданная руками (`Room.position`), — исключения вроде «люкс 512
  стоит над 410».

Правило только читает номер и ничего не пишет: сменили правило — схема
перестроилась, данные номеров не тронуты.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

SETTINGS_KEY = "room_numbers"
DEFAULT_RULE = {"floor_digits": 0, "position_digits": 2}
# «Вилла-12», «A-305», «3А»: голова до первой цифры, цифры, хвост.
_SPLIT = re.compile(r"^(?P<head>\D*?)(?P<digits>\d+)(?P<tail>.*)$")


def rule_of(hotel) -> dict[str, int]:
    """Правило отеля; что не задано или задано криво — по умолчанию."""
    raw = (hotel.settings or {}).get(SETTINGS_KEY) or {}
    rule = dict(DEFAULT_RULE)
    for key, low, high in (("floor_digits", 0, 3), ("position_digits", 1, 3)):
        value = raw.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
            rule[key] = value
    return rule


def is_default(rule: dict[str, int]) -> bool:
    return rule == DEFAULT_RULE


@dataclass(frozen=True)
class Place:
    floor: str
    floor_source: str  # room | rule | none
    position: str
    position_source: str  # manual | rule | none


def read_number(number: str, rule: dict[str, int]) -> tuple[str, str]:
    """
    Этаж и позиция из номера по правилу; не читается — пустые строки.

    «2205» (по умолчанию) → («22», «05»); с `floor_digits=1` → («2», «05»);
    «3А» → («», «3А»): цифр не больше позиции, этажа в номере нет;
    «203А» → («2», «03А»): хвост-буква остаётся у позиции.
    """
    match = _SPLIT.match((number or "").strip())
    if not match:
        return "", ""
    digits, tail = match["digits"], match["tail"].strip()
    size = rule["position_digits"]
    if len(digits) <= size:
        return "", digits + tail
    head = digits[:-size]
    if rule["floor_digits"]:
        head = head[: rule["floor_digits"]]
    floor = head.lstrip("0") or "0"
    return floor, digits[-size:] + tail


def place_of(room, rule: dict[str, int]) -> Place:
    """Где стоит номер: заданное у номера сильнее правила."""
    rule_floor, rule_position = read_number(room.number, rule)
    if room.floor:
        floor, floor_source = room.floor, "room"
    elif rule_floor:
        floor, floor_source = rule_floor, "rule"
    else:
        floor, floor_source = "", "none"
    manual = (getattr(room, "position", "") or "").strip()
    if manual:
        position, position_source = manual, "manual"
    elif rule_position:
        position, position_source = rule_position, "rule"
    else:
        position, position_source = "", "none"
    return Place(floor, floor_source, position, position_source)


def set_rule(hotel, floor_digits: int, position_digits: int) -> tuple[dict[str, int], dict[str, int]]:
    """Записать правило отеля; вернуть (было, стало)."""
    before = rule_of(hotel)
    after = {"floor_digits": int(floor_digits), "position_digits": int(position_digits)}
    settings: dict[str, Any] = dict(hotel.settings or {})
    settings[SETTINGS_KEY] = after
    hotel.settings = settings
    hotel.save(update_fields=["settings", "updated_at"])
    return before, after
