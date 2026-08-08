"""
Доступность категорий и позиций — один расчёт на всю систему.

Раньше похожая логика жила в трёх местах: в сборке меню, в модели и в создании
заказа. Расхождение здесь означало бы худший из возможных багов витрины —
позицию, которую гость видит доступной, но заказать не может (или наоборот,
заказ блюда, которого нет). Поэтому расчёт один, и его результат одинаково
используют и выдача меню, и валидация заказа.

Всё считается в таймзоне отеля: «кухня до 23:00» — это 23:00 у отеля, а не на
сервере и не в телефоне гостя.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime

from apps.hotels.models import ScheduleAvailability

# Причины недоступности — часть контракта с фронтом, поэтому константами.
REASON_INACTIVE = "inactive"
REASON_SCHEDULE = "schedule"
REASON_OUT_OF_STOCK = "out_of_stock"
REASON_CATEGORY = "category_unavailable"


@dataclasses.dataclass(slots=True)
class Availability:
    is_available: bool
    reason: str | None = None
    available_from: str | None = None
    available_until: str | None = None

    def as_dict(self) -> dict:
        return {
            "is_available": self.is_available,
            "unavailable_reason": self.reason,
            "available_from": self.available_from,
            "available_until": self.available_until,
        }


AVAILABLE = Availability(is_available=True)


def _schedule_state(obj, moment: datetime | None) -> ScheduleAvailability | None:
    """None — расписания нет, значит ограничений по времени нет."""
    if not obj.schedule_id:
        return None
    return obj.schedule.availability_at(moment)


def category_availability(category, moment: datetime | None = None) -> Availability:
    """
    Категория недоступна, если выключена, вне расписания или если недоступен
    любой из её родителей: выключенный «Ресторан» гасит и «Горячее» внутри.
    """
    if not category.is_active:
        return Availability(False, REASON_INACTIVE)

    state = _schedule_state(category, moment)
    if state is not None and not state.is_open:
        return Availability(False, REASON_SCHEDULE, available_from=state.available_from)

    parent = category.parent
    if parent is not None:
        parent_state = category_availability(parent, moment)
        if not parent_state.is_available:
            return Availability(
                False,
                parent_state.reason or REASON_CATEGORY,
                available_from=parent_state.available_from,
            )

    return Availability(
        True,
        available_until=state.available_until if state else None,
    )


def item_availability(item, moment: datetime | None = None, *, category=None) -> Availability:
    """
    Порядок проверок = порядок важности для гостя. «Нет в наличии» полезнее
    услышать, чем «вне расписания», даже если верно и то и другое: со стоп-листом
    ждать бесполезно, а часов можно дождаться.
    """
    if not item.is_active:
        return Availability(False, REASON_INACTIVE)
    if not item.in_stock:
        return Availability(False, REASON_OUT_OF_STOCK)

    state = _schedule_state(item, moment)
    if state is not None and not state.is_open:
        return Availability(False, REASON_SCHEDULE, available_from=state.available_from)

    category = category or item.category
    category_state = category_availability(category, moment)
    if not category_state.is_available:
        return Availability(
            False,
            REASON_SCHEDULE if category_state.reason == REASON_SCHEDULE else REASON_CATEGORY,
            available_from=category_state.available_from,
        )

    return Availability(
        True,
        available_until=state.available_until if state else category_state.available_until,
    )
