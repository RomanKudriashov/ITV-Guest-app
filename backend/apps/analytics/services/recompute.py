"""
Пересчёт агрегатов.

Два режима:

* `recompute_aggregates` — обнулить роллапы и прогнать редьюсер по журналу.
  Это и есть проверка «пересчёт == живая агрегация»: тот же редьюсер над тем
  же журналом обязан дать те же числа.
* `rebuild_raw_from_orders` — восстановить журнал из живых заказов/сессий/
  отзывов (для истории до аналитики или починки расхождений), затем пересчёт.
"""

from __future__ import annotations

from apps.core.context import tenant_context

from apps.analytics.services import collector
from apps.analytics.models import DAILY_MODELS, AnalyticsEvent


def recompute_aggregates(hotel_id) -> int:
    """Обнулить роллапы и заново применить весь журнал. Возвращает число фактов."""
    with tenant_context(hotel_id):
        for model in DAILY_MODELS:
            model.objects.all().hard_delete()
        events = list(AnalyticsEvent.objects.all().order_by("occurred_at", "created_at"))
        for raw in events:
            collector.apply_event(raw)
        return len(events)


def _point_at(order, moment, transfers):
    """
    Точка, на которой заказ был в момент события (партия 48).

    Без переносов — текущая. С переносами: последний перенос не позже момента
    даёт свою точку-цель; до первого переноса — точка-источник первого.
    """
    if not transfers or moment is None:
        return order.execution_point_id
    for transfer in reversed(transfers):
        if transfer.created_at <= moment:
            return transfer.to_point_id or order.execution_point_id
    return transfers[0].from_point_id or order.execution_point_id


def _build_at(builder, order, hotel, moment, transfers):
    """Сборщик события — с точкой на момент события; точка заказа в памяти возвращается."""
    current = order.execution_point_id
    order.execution_point_id = _point_at(order, moment, transfers)
    try:
        return builder(order, hotel)
    finally:
        order.execution_point_id = current


def rebuild_raw_from_orders(hotel_id) -> int:
    """Пересобрать журнал из оперативных таблиц (без применения)."""
    from apps.accounts.models import GuestSession
    from apps.hotels.models import Hotel
    from apps.orders.models import Order
    from apps.reviews.models import Review

    with tenant_context(hotel_id):
        hotel = Hotel.objects.get(pk=hotel_id)
        AnalyticsEvent.objects.all().hard_delete()

        written = 0
        for session in GuestSession.objects.all().iterator():
            collector.write_raw(hotel_id, collector.build_session(session, hotel))
            written += 1

        # children (parent_id задан) — исполнение; аналитику несёт parent-агрегат
        # (build_created берёт их позиции). Так пересчёт совпадает с живым потоком.
        orders = (
            Order.objects.select_related("status", "guest_session", "execution_point", "location")
            .prefetch_related(
                "items__item__category", "children__items__item__category", "transfers"
            )
            .filter(parent__isnull=True)
        )
        # ПЕРЕНОСЫ (партия 48): живой сбор пишет каждое событие с точкой на свой
        # момент; пересборка обязана дать то же — иначе вся история
        # перенесённого заказа ушла бы на последнюю точку: создание за старой,
        # работа за новой.
        for order in orders.iterator(chunk_size=200):
            transfers = list(order.transfers.all())
            collector.write_raw(
                hotel_id, _build_at(collector.build_created, order, hotel, order.created_at, transfers)
            )
            collector.write_raw(
                hotel_id, _build_at(collector.build_accepted, order, hotel, order.accepted_at, transfers)
            )
            if order.status.is_terminal and not order.status.is_cancelled:
                collector.write_raw(
                    hotel_id,
                    _build_at(collector.build_completed, order, hotel, order.closed_at, transfers),
                )
            if order.status.is_cancelled:
                collector.write_raw(
                    hotel_id,
                    _build_at(collector.build_cancelled, order, hotel, order.closed_at, transfers),
                )
            written += 1

        for review in Review.objects.select_related("order").all().iterator():
            collector.write_raw(hotel_id, collector.build_review(review, hotel))
            written += 1

        return written
