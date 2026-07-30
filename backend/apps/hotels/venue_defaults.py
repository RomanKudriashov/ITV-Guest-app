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


# Род исполнителя → тип-шаблон его сервиса. Единый источник для рантайма
# (админка/сид/провижининг); миграция-бэкфилл hotels/0011 держит свою копию —
# держите их синхронными.
KIND_TO_SERVICE_TYPE = {
    "kitchen": "restaurant",
    "bar": "bar",
    "spa": "spa",
    "housekeeping": "housekeeping",
    "reception": "concierge",
    "other": "custom",
}


def service_type_for_kind(kind: str) -> str:
    return KIND_TO_SERVICE_TYPE.get(kind, "custom")
