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


def room_category_for_order(order) -> str:
    """
    Категория номера — СНИМКОМ В МОМЕНТ ЗАКАЗА, а не справкой по комнате.

    Соблазн был резолвить её на чтении: `order.room.category`. Так проще, и так
    неверно: отель переводит комнату из «Стандарта» в «Делюкс» — и ВСЯ прошлая
    выручка этой комнаты задним числом переезжает в «Делюкс». Отчёт за март
    меняется в июне, притом что в марте продавали стандарт.

    Поэтому значение снимается один раз, при создании заказа, и дальше живёт
    само — как `subtotal_minor` у выручки и `point_key` у точки.

    Пустая строка — это «без категории», и она РАВНОПРАВНОЕ значение: под ней
    лежат и номера без категории, и заказы, созданные до появления разреза.
    Прятать её нельзя — сумма долей перестанет сходиться с итогом.
    """
    room = getattr(order, "room", None)
    if room is None or not getattr(room, "category_id", None):
        return ""
    return str(room.category_id)


def offering_type_for_order(order) -> str:
    """
    Тип оффера заказа — это тип категории его позиций (данные, не ветка кода).
    Поток гарантирует однородность типа в заказе; берём по первой позиции.
    """
    item = order.items.select_related("item__category").first()
    if item is not None and item.item and item.item.category_id:
        return item.item.category.type or ""
    return ""
