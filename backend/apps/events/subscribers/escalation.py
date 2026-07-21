"""
Подписчик эскалации: заявка появилась — планируем подъём, заявку взяли —
гасим.

Подписчик, а не вызов из сервисного слоя заказов: заказы не должны знать про
существование уведомлений. Появится следующий потребитель события (аналитика,
интеграция с PMS) — он подпишется так же и ничего не сломает.
"""

from __future__ import annotations

import logging

from django.conf import settings

from apps.core.context import tenant_context
from apps.events.bus import (
    ORDER_ACCEPTED,
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    Event,
    subscribe,
)

logger = logging.getLogger("apps.notifications")


@subscribe(ORDER_CREATED)
def plan_escalation_for_new_order(event: Event) -> None:
    if not settings.NOTIFICATIONS_ENABLED:
        return

    from apps.notifications.tasks import plan_escalation_task

    order_id = event.payload.get("order_id")
    if not order_id:
        return
    # В фон: создание заказа не должно ждать разбора правил и брокера.
    plan_escalation_task.delay(order_id, event.hotel_id)


@subscribe(ORDER_ACCEPTED, ORDER_STATUS_CHANGED, ORDER_CANCELLED)
def stop_escalation_when_handled(event: Event) -> None:
    """
    Гасим запланированные ступени, как только за заявку кто-то отвечает.

    Это оптимизация, а не гарантия: задача могла уйти в исполнение секундой
    раньше. Настоящая защита — проверка состояния внутри самой ступени.
    """
    if not settings.NOTIFICATIONS_ENABLED:
        return

    from apps.notifications.services import cancel_pending, escalation_should_stop
    from apps.orders.services import order_queryset

    order_id = event.payload.get("order_id")
    if not order_id:
        return

    with tenant_context(event.hotel_id):
        order = order_queryset().filter(pk=order_id).first()
        if order is None or not escalation_should_stop(order):
            return
        cancelled = cancel_pending(order)
        if cancelled:
            logger.info("Эскалация заказа %s погашена (%s ступеней)", order_id, cancelled)
