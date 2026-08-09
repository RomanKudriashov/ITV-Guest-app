"""Аналитика: события, суточные витрины, выгрузки."""

from __future__ import annotations

from .daily import ItemDaily, ModifierDaily, OrderDaily, ReviewDaily, SessionDaily
from .event import AnalyticsEvent
from .export import AnalyticsExport

# Реестр суточных витрин: пересчёт проходит по нему, а не по списку в коде
# пересчёта. Живёт ЗДЕСЬ, а не в одном из файлов моделей: он про все пять сразу.
DAILY_MODELS = [OrderDaily, ItemDaily, ModifierDaily, SessionDaily, ReviewDaily]

__all__ = [
    "DAILY_MODELS",
    "AnalyticsEvent",
    "AnalyticsExport",
    "ItemDaily",
    "ModifierDaily",
    "OrderDaily",
    "ReviewDaily",
    "SessionDaily",
]
