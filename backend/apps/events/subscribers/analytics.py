"""
Подписчик аналитики.

Держит шов: аналитика питается СОБЫТИЯМИ, а не ходит в оперативные таблицы на
чтение дашборда. Каждое доменное событие превращается в сырые факты и
инкрементит дневные роллапы через единый вход `record(...)`. Падение здесь не
роняет операцию (гарантия шины).
"""

from __future__ import annotations

import logging

from apps.analytics import collector
from apps.core.context import tenant_context
from apps.events.bus import (
    ORDER_ACCEPTED,
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    REVIEW_CREATED,
    SESSION_STARTED,
    Event,
    subscribe,
)

logger = logging.getLogger("apps.analytics")


def _hotel(hotel_id):
    from apps.hotels.models import Hotel

    return Hotel.objects.get(pk=hotel_id)


def _order(order_id):
    from apps.orders.models import Order

    return (
        Order.objects.select_related("status", "guest_session", "room", "execution_point", "location")
        .filter(pk=order_id)
        .first()
    )


def _ingest(hotel_id, raws) -> None:
    for raw in raws:
        collector.record(hotel_id, raw)


@subscribe(ORDER_CREATED)
def on_order_created(event: Event) -> None:
    with tenant_context(event.hotel_id):
        order = _order(event.payload.get("order_id"))
        if order is None:
            return
        _ingest(event.hotel_id, collector.build_created(order, _hotel(event.hotel_id), bus_event_id=event.id))


@subscribe(ORDER_ACCEPTED)
def on_order_accepted(event: Event) -> None:
    with tenant_context(event.hotel_id):
        order = _order(event.payload.get("order_id"))
        if order is None:
            return
        _ingest(event.hotel_id, collector.build_accepted(order, _hotel(event.hotel_id), bus_event_id=event.id))


@subscribe(ORDER_STATUS_CHANGED)
def on_order_status_changed(event: Event) -> None:
    with tenant_context(event.hotel_id):
        order = _order(event.payload.get("order_id"))
        if order is None or not order.status.is_terminal or order.status.is_cancelled:
            return
        _ingest(event.hotel_id, collector.build_completed(order, _hotel(event.hotel_id), bus_event_id=event.id))


@subscribe(ORDER_CANCELLED)
def on_order_cancelled(event: Event) -> None:
    with tenant_context(event.hotel_id):
        order = _order(event.payload.get("order_id"))
        if order is None:
            return
        _ingest(event.hotel_id, collector.build_cancelled(order, _hotel(event.hotel_id), bus_event_id=event.id))


@subscribe(REVIEW_CREATED)
def on_review_created(event: Event) -> None:
    with tenant_context(event.hotel_id):
        from apps.reviews.models import Review

        review = Review.objects.select_related("order").filter(pk=event.payload.get("review_id")).first()
        if review is None:
            return
        _ingest(event.hotel_id, collector.build_review(review, _hotel(event.hotel_id), bus_event_id=event.id))


@subscribe(SESSION_STARTED)
def on_session_started(event: Event) -> None:
    with tenant_context(event.hotel_id):
        from apps.accounts.models import GuestSession

        session = GuestSession.objects.filter(pk=event.payload.get("session_id")).first()
        if session is None:
            return
        _ingest(event.hotel_id, collector.build_session(session, _hotel(event.hotel_id), bus_event_id=event.id))
