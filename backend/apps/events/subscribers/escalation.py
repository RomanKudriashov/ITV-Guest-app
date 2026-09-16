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
    # parent-агрегат не эскалируем — исполнение (и подъём) на children.
    from apps.orders.models import Order

    with tenant_context(event.hotel_id):
        if Order.objects.filter(pk=order_id, children__isnull=False).exists():
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


@subscribe(ORDER_CANCELLED)
def notify_point_of_cancellation(event: Event) -> None:
    """
    Отмена → отделу: готовить уже не для кого.

    Не шлём, когда отменил сам отдел: сотрудник, отменивший заявку со своей
    доски, знает об этом лучше всех, а сообщение ему же — первый шаг к каналу,
    который перестают читать. Отмена гостем, другим отделом или системой —
    уходит. Агрегат (заказ из нескольких отделов) не шлём: каждая его часть
    сообщает о себе сама, своему отделу.
    """
    order_id = event.payload.get("order_id")
    point_id = event.payload.get("execution_point_id")
    if not order_id or not point_id:
        return

    from apps.accounts.models import StaffAssignment
    from apps.notifications.services import event_values
    from apps.notifications.services.events import notify
    from apps.orders.models import Order

    try:
        with tenant_context(event.hotel_id):
            order = (
                Order.objects.filter(pk=order_id, children__isnull=True)
                .select_related("hotel", "room", "execution_point")
                .first()
            )
            if order is None:
                return
            if (
                event.actor_type == "staff"
                and event.actor_id
                and StaffAssignment.objects.filter(
                    user_id=event.actor_id, execution_point_id=point_id, is_active=True
                ).exists()
            ):
                return
            notify(
                "order.cancelled",
                event_values.order_cancelled(order, event_values.cancel_comment(order)),
                point_id=point_id,
                dedupe_key=f"order.cancelled:{event.id}",
            )
    except Exception:  # noqa: BLE001 — уведомление не вправе уронить отмену
        logger.warning("Уведомление об отмене %s не записано", order_id, exc_info=True)
