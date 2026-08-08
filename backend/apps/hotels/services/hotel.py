"""
Отель текущего запроса.

Одна строка, вынесенная из четырёх вьюх: `Hotel.objects.get(pk=require_hotel_id())`.
Права здесь НЕ проверяются — это делают роутер и роли. Калитка для настроек
уровня отеля — отдельная функция `hotel_settings.hotel_for_settings()`, и
путать их нельзя: у них разные требования к роли.
"""

from __future__ import annotations

from apps.core.context import require_hotel_id

from apps.hotels.models import Hotel


def current_hotel() -> Hotel:
    return Hotel.objects.get(pk=require_hotel_id())
