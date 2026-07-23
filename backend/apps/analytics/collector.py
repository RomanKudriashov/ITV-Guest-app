"""
Сбор аналитики: один вход, один редьюсер.

`record(...)` пишет сырое событие (дедуп по натуральному ключу) и, только если
оно новое, применяет `apply_event(...)` — инкременты в дневные роллапы. Редьюсер
читает ТОЛЬКО слепок сырой строки, не живые заказы. Поэтому:

  * повтор события не двоит счётчик (дедуп),
  * пересчёт по журналу даёт те же числа (тот же редьюсер над теми же данными).

Билдеры (`build_*`) собирают слепки из живых объектов — их зовут и живой
подписчик, и сид, и восстановление журнала из заказов. Разница лишь в том,
записываем ли мы слепок с применением (`record`) или без (`write_raw`).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from django.db.models import F
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Hotel

from . import dimensions as dim
from .models import (
    AnalyticsEvent,
    ItemDaily,
    ModifierDaily,
    OrderDaily,
    ReviewDaily,
    SessionDaily,
)


# --- Запись и редьюсер ------------------------------------------------------


def record(hotel_id, raw: dict[str, Any]) -> bool:
    """Записать один сырой факт и применить его. True — если факт новый."""
    with tenant_context(hotel_id):
        obj, created = AnalyticsEvent.objects.get_or_create(
            dedupe_key=raw["dedupe_key"],
            defaults={
                "bus_event_id": raw.get("bus_event_id"),
                "kind": raw["kind"],
                "name": raw.get("name", ""),
                "occurred_at": raw["occurred_at"],
                "business_date": raw["business_date"],
                "order_id": raw.get("order_id"),
                "subject_id": raw.get("subject_id"),
                "dimensions": raw.get("dimensions", {}),
                "measures": raw.get("measures", {}),
            },
        )
        if created:
            apply_event(obj)
        return created


def write_raw(hotel_id, raws: list[dict]) -> None:
    """Записать слепки без применения — для восстановления журнала перед пересчётом."""
    with tenant_context(hotel_id):
        for raw in raws:
            AnalyticsEvent.objects.get_or_create(
                dedupe_key=raw["dedupe_key"],
                defaults={
                    "bus_event_id": raw.get("bus_event_id"),
                    "kind": raw["kind"],
                    "name": raw.get("name", ""),
                    "occurred_at": raw["occurred_at"],
                    "business_date": raw["business_date"],
                    "order_id": raw.get("order_id"),
                    "subject_id": raw.get("subject_id"),
                    "dimensions": raw.get("dimensions", {}),
                    "measures": raw.get("measures", {}),
                },
            )


def _bump(model, keys: dict, incs: dict) -> None:
    obj, _ = model.objects.get_or_create(**keys)
    model.objects.filter(pk=obj.pk).update(**{field: F(field) + value for field, value in incs.items()})


def apply_event(raw: AnalyticsEvent) -> None:
    """Единственное место инкрементов. Ветвление по `kind`, а не по типу оффера."""
    d = raw.dimensions or {}
    m = raw.measures or {}
    bd = raw.business_date
    kind = raw.kind

    if kind == "order_item":
        _bump(
            ItemDaily,
            {
                "business_date": bd,
                "item_key": d.get("item_key", ""),
                "point_key": d.get("point_key", ""),
                "category_key": d.get("category_key", ""),
                "offering_type": d.get("offering_type", ""),
            },
            {
                "quantity": int(m.get("quantity", 0)),
                "revenue_minor": int(m.get("revenue_minor", 0)),
                "orders_count": int(m.get("orders", 0)),
            },
        )
    elif kind == "order_modifier":
        _bump(
            ModifierDaily,
            {"business_date": bd, "modifier_key": d.get("modifier_key", ""), "point_key": d.get("point_key", "")},
            {"quantity": int(m.get("quantity", 0))},
        )
    elif kind == "order_created":
        _bump(
            OrderDaily,
            {
                "business_date": bd,
                "offering_type": d.get("offering_type", ""),
                "point_key": d.get("point_key", ""),
                "location_key": d.get("location_key", ""),
                "entry_method": d.get("entry_method", ""),
                "device": d.get("device", ""),
                "language": d.get("language", ""),
            },
            {
                "orders_count": 1,
                "revenue_minor": int(m.get("revenue_minor", 0)),
                "service_fee_minor": int(m.get("service_fee_minor", 0)),
                "delivery_minor": int(m.get("delivery_minor", 0)),
                "tax_minor": int(m.get("tax_minor", 0)),
                "tip_minor": int(m.get("tip_minor", 0)),
                "items_count": int(m.get("items_count", 0)),
                "off_hours_count": int(m.get("off_hours", 0)),
            },
        )
    elif kind == "order_accepted":
        _bump(
            OrderDaily,
            _order_daily_keys(bd, d),
            {"reaction_seconds_sum": int(m.get("reaction_seconds") or 0), "reaction_count": 1},
        )
    elif kind == "order_completed":
        _bump(
            OrderDaily,
            _order_daily_keys(bd, d),
            {
                "completed_count": 1,
                "fulfil_seconds_sum": int(m.get("fulfil_seconds") or 0),
                "fulfil_count": 1 if m.get("fulfil_seconds") is not None else 0,
            },
        )
    elif kind == "order_cancelled":
        _bump(OrderDaily, _order_daily_keys(bd, d), {"cancelled_count": 1})
    elif kind == "session_started":
        _bump(
            SessionDaily,
            _session_keys(bd, d),
            {"sessions_count": 1},
        )
    elif kind == "order_conversion":
        _bump(SessionDaily, _session_keys(bd, d), {"converted_count": 1})
    elif kind == "review":
        _bump(
            ReviewDaily,
            {
                "business_date": bd,
                "point_key": d.get("point_key", ""),
                "offering_type": d.get("offering_type", ""),
            },
            {
                "reviews_count": 1,
                "rating_sum": int(m.get("rating", 0)),
                "low_count": int(m.get("low", 0)),
            },
        )


def _order_daily_keys(bd, d: dict) -> dict:
    return {
        "business_date": bd,
        "offering_type": d.get("offering_type", ""),
        "point_key": d.get("point_key", ""),
        "location_key": d.get("location_key", ""),
        "entry_method": d.get("entry_method", ""),
        "device": d.get("device", ""),
        "language": d.get("language", ""),
    }


def _session_keys(bd, d: dict) -> dict:
    return {
        "business_date": bd,
        "entry_method": d.get("entry_method", ""),
        "device": d.get("device", ""),
        "language": d.get("language", ""),
    }


# --- Билдеры слепков --------------------------------------------------------


def _order_dims(order, session) -> dict:
    return {
        "offering_type": dim.offering_type_for_order(order),
        "point_key": str(order.execution_point_id) if order.execution_point_id else "",
        "location_key": str(order.location_id) if order.location_id else "",
        "entry_method": dim.entry_method_for(session),
        "device": dim.device_for(session),
        "language": dim.language_for(session),
    }


def _is_off_hours(order) -> int:
    """Заказ вне часов позиции — упущенный/внеурочный спрос. Считаем при записи."""
    from apps.catalog.availability import item_availability  # локально: тяжёлый импорт

    item = order.items.select_related("item", "item__schedule", "item__category__schedule").first()
    if item is None or item.item is None:
        return 0
    try:
        return 0 if item_availability(item.item).is_available else 1
    except Exception:  # noqa: BLE001 — доступность не должна ронять аналитику
        return 0


def build_created(order, hotel: Hotel, *, bus_event_id=None) -> list[dict]:
    session = order.guest_session
    bd = dim.business_date_for(hotel, order.created_at)
    dims = _order_dims(order, session)
    items = list(order.items.select_related("item", "item__category").all())
    items_count = sum(i.quantity for i in items)
    point_key = str(order.execution_point_id) if order.execution_point_id else ""

    raws: list[dict] = [
        {
            "dedupe_key": f"order_created:{order.pk}",
            "bus_event_id": bus_event_id,
            "kind": "order_created",
            "name": "order.created",
            "occurred_at": order.created_at,
            "business_date": bd,
            "order_id": order.pk,
            "dimensions": dims,
            "measures": {
                # Выручка по позициям = subtotal снимка. Обратная совместимость:
                # у старых заказов без снимка subtotal_minor=0 → берём total (всё
                # в позициях), компоненты по нулям.
                "revenue_minor": int(order.subtotal_minor or order.total or 0),
                "service_fee_minor": int(order.service_fee_minor or 0),
                "delivery_minor": int(order.delivery_fee_minor or 0),
                "tax_minor": int(order.tax_minor or 0),
                "tip_minor": int(order.tip_minor or 0),
                "items_count": items_count,
                "off_hours": _is_off_hours(order),
            },
        }
    ]

    for line in items:
        category_id = line.item.category_id if line.item else None
        offering_type = line.item.category.type if (line.item and line.item.category_id) else ""
        raws.append(
            {
                "dedupe_key": f"order_item:{line.pk}",
                "bus_event_id": bus_event_id,
                "kind": "order_item",
                "name": "order.created",
                "occurred_at": order.created_at,
                "business_date": bd,
                "order_id": order.pk,
                "subject_id": line.item_id,
                "dimensions": {
                    "item_key": str(line.item_id),
                    "category_key": str(category_id) if category_id else "",
                    "offering_type": offering_type or "",
                    "point_key": point_key,
                },
                "measures": {
                    "quantity": line.quantity,
                    "revenue_minor": int(line.line_total or 0),
                    "orders": 1,
                },
            }
        )
        for mod in _modifier_codes(line):
            raws.append(
                {
                    "dedupe_key": f"order_modifier:{line.pk}:{mod}",
                    "bus_event_id": bus_event_id,
                    "kind": "order_modifier",
                    "name": "order.created",
                    "occurred_at": order.created_at,
                    "business_date": bd,
                    "order_id": order.pk,
                    "dimensions": {"modifier_key": mod, "point_key": point_key},
                    "measures": {"quantity": line.quantity},
                }
            )

    conv = _build_conversion(order, session, hotel, bus_event_id)
    if conv is not None:
        raws.append(conv)
    return raws


def _modifier_codes(line) -> list[str]:
    """Коды выбранных опций из снапшота строки (формат снапшота — список групп)."""
    codes: list[str] = []
    snapshot = line.modifiers_snapshot or []
    for group in snapshot:
        if not isinstance(group, dict):
            continue
        for option in group.get("options", []) or []:
            if isinstance(option, dict) and option.get("code"):
                codes.append(str(option["code"]))
            elif isinstance(option, str):
                codes.append(option)
    return codes


def _build_conversion(order, session, hotel: Hotel, bus_event_id) -> dict | None:
    """
    Конверсия «зашёл → заказал» — по первому заказу сессии. «Первый» берём как
    самый ранний по created_at: решение стабильно и в живом потоке, и в
    восстановлении. Натуральный ключ на сессию гарантирует счёт ровно раз.
    """
    if session is None:
        return None
    from apps.orders.models import Order

    earliest = (
        Order.objects.filter(guest_session_id=session.pk).order_by("created_at", "number").first()
    )
    if earliest is None or earliest.pk != order.pk:
        return None
    bd = dim.business_date_for(hotel, session.created_at)
    return {
        "dedupe_key": f"order_conversion:{session.pk}",
        "bus_event_id": bus_event_id,
        "kind": "order_conversion",
        "name": "order.created",
        "occurred_at": session.created_at,
        "business_date": bd,
        "subject_id": session.pk,
        "dimensions": {
            "entry_method": dim.entry_method_for(session),
            "device": dim.device_for(session),
            "language": dim.language_for(session),
        },
        "measures": {},
    }


def build_accepted(order, hotel: Hotel, *, bus_event_id=None) -> list[dict]:
    if not order.accepted_at:
        return []
    reaction = max(int((order.accepted_at - order.created_at).total_seconds()), 0)
    return [
        {
            "dedupe_key": f"order_accepted:{order.pk}",
            "bus_event_id": bus_event_id,
            "kind": "order_accepted",
            "name": "order.accepted",
            "occurred_at": order.accepted_at,
            "business_date": dim.business_date_for(hotel, order.created_at),
            "order_id": order.pk,
            "dimensions": _order_dims(order, order.guest_session),
            "measures": {"reaction_seconds": reaction},
        }
    ]


def _terminal_transition_time(order, *, cancelled: bool) -> datetime | None:
    """
    Время перехода в терминальный статус — из истории переходов, а не now().
    Так живой поток и восстановление из заказов дают одно и то же число.
    """
    from apps.orders.models import OrderStatusChange

    change = (
        OrderStatusChange.objects.filter(order_id=order.pk, to_status__is_terminal=True, to_status__is_cancelled=cancelled)
        .order_by("-created_at")
        .first()
    )
    return change.created_at if change else None


def build_completed(order, hotel: Hotel, *, when: datetime | None = None, bus_event_id=None) -> list[dict]:
    when = when or _terminal_transition_time(order, cancelled=False) or timezone.now()
    fulfil = None
    if order.accepted_at:
        fulfil = max(int((when - order.accepted_at).total_seconds()), 0)
    return [
        {
            "dedupe_key": f"order_completed:{order.pk}",
            "bus_event_id": bus_event_id,
            "kind": "order_completed",
            "name": "order.status_changed",
            "occurred_at": when,
            "business_date": dim.business_date_for(hotel, order.created_at),
            "order_id": order.pk,
            "dimensions": _order_dims(order, order.guest_session),
            "measures": {"fulfil_seconds": fulfil},
        }
    ]


def build_cancelled(order, hotel: Hotel, *, when: datetime | None = None, bus_event_id=None) -> list[dict]:
    when = when or _terminal_transition_time(order, cancelled=True) or timezone.now()
    return [
        {
            "dedupe_key": f"order_cancelled:{order.pk}",
            "bus_event_id": bus_event_id,
            "kind": "order_cancelled",
            "name": "order.cancelled",
            "occurred_at": when,
            "business_date": dim.business_date_for(hotel, order.created_at),
            "order_id": order.pk,
            "dimensions": _order_dims(order, order.guest_session),
            "measures": {},
        }
    ]


def build_session(session, hotel: Hotel, *, bus_event_id=None) -> list[dict]:
    return [
        {
            "dedupe_key": f"session_started:{session.pk}",
            "bus_event_id": bus_event_id,
            "kind": "session_started",
            "name": "session.started",
            "occurred_at": session.created_at,
            "business_date": dim.business_date_for(hotel, session.created_at),
            "subject_id": session.pk,
            "dimensions": {
                "entry_method": dim.entry_method_for(session),
                "device": dim.device_for(session),
                "language": dim.language_for(session),
            },
            "measures": {},
        }
    ]


def build_review(review, hotel: Hotel, *, bus_event_id=None) -> list[dict]:
    order = review.order
    low = 1 if review.rating <= hotel.review_low_threshold else 0
    return [
        {
            "dedupe_key": f"review:{review.pk}",
            "bus_event_id": bus_event_id,
            "kind": "review",
            "name": "review.created",
            "occurred_at": review.created_at,
            "business_date": dim.business_date_for(hotel, review.created_at),
            "order_id": order.pk if order else None,
            "subject_id": review.pk,
            "dimensions": {
                "point_key": str(order.execution_point_id) if (order and order.execution_point_id) else "",
                "offering_type": dim.offering_type_for_order(order) if order else "",
            },
            "measures": {"rating": review.rating, "low": low},
        }
    ]
