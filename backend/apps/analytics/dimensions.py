"""
Извлечение измерений из живых объектов — в одном месте, чтобы и подписчик, и
сид, и пересчёт видели значения одинаково.

Часовой пояс: `business_date` — это дата в сутках ОТЕЛЯ. Считается один раз при
записи сырого события; дальше повсюду группируем по ней.
"""

from __future__ import annotations

from datetime import date, datetime

from apps.hotels.models import Hotel


def business_date_for(hotel: Hotel, moment: datetime) -> date:
    """Дата в часовом поясе отеля (сутки отеля, не UTC)."""
    return hotel.to_local(moment).date()


def entry_method_for(session) -> str:
    """
    Способ входа выводим из уровня доверия и наличия номера: отдельного поля
    в модели нет, но trust его достаточно описывает.
      room_scanned + номер → QR в номере; anonymous → открыл ссылку; и т.д.
    """
    if session is None:
        return "unknown"
    return session.trust or "unknown"


def device_for(session) -> str:
    """Грубая категория устройства из user-agent — единственного сигнала."""
    ua = (getattr(session, "user_agent", "") or "").lower()
    if not ua:
        return "unknown"
    if "ipad" in ua or "tablet" in ua or ("android" in ua and "mobile" not in ua):
        return "tablet"
    if "mobi" in ua or "iphone" in ua or "android" in ua:
        return "mobile"
    return "desktop"


def language_for(session) -> str:
    return (getattr(session, "language", "") or "") if session is not None else ""


def offering_type_for_order(order) -> str:
    """
    Тип оффера заказа — это тип категории его позиций (данные, не ветка кода).
    Поток гарантирует однородность типа в заказе; берём по первой позиции.
    """
    item = order.items.select_related("item__category").first()
    if item is not None and item.item and item.item.category_id:
        return item.item.category.type or ""
    return ""
