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

from . import collector
from .models import DAILY_MODELS, AnalyticsEvent


def recompute_aggregates(hotel_id) -> int:
    """Обнулить роллапы и заново применить весь журнал. Возвращает число фактов."""
    with tenant_context(hotel_id):
        for model in DAILY_MODELS:
            model.objects.all().hard_delete()
        events = list(AnalyticsEvent.objects.all().order_by("occurred_at", "created_at"))
        for raw in events:
            collector.apply_event(raw)
        return len(events)


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

        orders = (
            Order.objects.select_related("status", "guest_session", "execution_point", "location")
            .prefetch_related("items__item__category")
            .all()
        )
        for order in orders.iterator(chunk_size=200):
            collector.write_raw(hotel_id, collector.build_created(order, hotel))
            collector.write_raw(hotel_id, collector.build_accepted(order, hotel))
            if order.status.is_terminal and not order.status.is_cancelled:
                collector.write_raw(hotel_id, collector.build_completed(order, hotel))
            if order.status.is_cancelled:
                collector.write_raw(hotel_id, collector.build_cancelled(order, hotel))
            written += 1

        for review in Review.objects.select_related("order").all().iterator():
            collector.write_raw(hotel_id, collector.build_review(review, hotel))
            written += 1

        return written
