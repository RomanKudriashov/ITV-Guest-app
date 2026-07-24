"""
Дефолт видимости точки исполнения гостю.

ЯВНАЯ логика (а не «default=True» на поле): заведение с гостевыми категориями
показывается на витрине, служебная точка (хозслужба) — нет, даже если на неё
что-то замаршрутизировано. Эта функция — единый источник правила: её зовёт сид,
её проверяет тест, её зеркалит бэкфилл-миграция (SQL). Держите их синхронными.
"""

from __future__ import annotations

# Рода точек, которые по умолчанию НЕ гостевые: чисто операционные службы.
BACK_OF_HOUSE_KINDS = frozenset({"housekeeping"})


def default_guest_facing(kind: str, has_guest_categories: bool) -> bool:
    return bool(has_guest_categories) and kind not in BACK_OF_HOUSE_KINDS
