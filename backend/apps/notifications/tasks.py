"""
Celery-задачи уведомлений: планирование эскалации и отправка.

КОГДА — решает служба расписания (`ScheduledJob`, вид
`notification.escalation_step`); ОТПРАВКУ делает Celery с повторами.
`run_escalation_step` остаётся для задач, поставленных до перехода на службу
расписания: они ещё могут лежать в очереди.

Задачи намеренно тонкие: вся логика в services.py, чтобы тесты могли вызывать
ступени напрямую и не ждать реальных минут. Задача умеет ровно две вещи —
установить контекст отеля и решить, повторять ли при ошибке.
"""

from __future__ import annotations

import logging

from celery import shared_task

from apps.core.context import tenant_context

from .channels.base import ChannelError

logger = logging.getLogger("apps.notifications")

# Повторы отправки. `retry_backoff` у Celery действует только вместе с
# `autoretry_for`; при ручном `self.retry()` пауза была бы постоянной (три
# минуты по умолчанию), поэтому нарастающую паузу считаем сами.
DELIVERY_RETRIES = 5


def _backoff(retries: int) -> int:
    """15 с, 30 с, 1 мин, 2 мин, 4 мин — и не больше 10 минут, плюс разброс."""
    import random

    return min(600, 15 * 2**retries) + random.randint(0, 5)


@shared_task(bind=True, max_retries=3, acks_late=True)
def run_escalation_step(self, log_id: str, hotel_id: str) -> dict:
    """
    Срабатывание ступени.

    У воркера нет HTTP-запроса, а значит и контекста тенанта — ставим его явно,
    иначе RLS не отдаст ни строки.
    """
    from .services import execute_step

    with tenant_context(hotel_id):
        try:
            log = execute_step(log_id)
        except Exception as exc:  # noqa: BLE001 — БД могла моргнуть
            logger.exception("Ступень %s упала", log_id)
            raise self.retry(exc=exc, countdown=30) from exc

        return {"log_id": log_id, "status": log.status if log else "missing"}


@shared_task(bind=True, max_retries=DELIVERY_RETRIES, acks_late=True)
def deliver_notification(self, log_id: str, hotel_id: str) -> dict:
    """
    Отправка в один канал.

    Ретраи с экспоненциальным backoff, но только для ошибок, которые имеет
    смысл повторять: неверный токен повтором не исправишь, и дёргать чужой API
    ради этого незачем.
    """
    from .services import mark_delivery_failed, send_delivery

    with tenant_context(hotel_id):
        try:
            log = send_delivery(log_id)
        except ChannelError as exc:
            if self.request.retries >= self.max_retries:
                mark_delivery_failed(log_id, f"Канал недоступен: {exc.detail}")
                return {"log_id": log_id, "status": "failed"}
            raise self.retry(exc=exc, countdown=_backoff(self.request.retries)) from exc

        return {"log_id": log_id, "status": log.status if log else "missing"}


@shared_task(bind=True, max_retries=DELIVERY_RETRIES, acks_late=True)
def deliver_event(self, delivery_id: str, hotel_id: str) -> dict:
    """
    Доставка события без заказа (журнал событий) в один канал — с теми же
    повторами, что у эскалации.
    """
    from .services.events import mark_event_delivery_failed, send_event_delivery

    with tenant_context(hotel_id):
        try:
            delivery = send_event_delivery(delivery_id)
        except ChannelError as exc:
            if self.request.retries >= self.max_retries:
                mark_event_delivery_failed(delivery_id, f"Канал недоступен: {exc.detail}")
                return {"delivery_id": delivery_id, "status": "failed"}
            raise self.retry(exc=exc, countdown=_backoff(self.request.retries)) from exc

        return {
            "delivery_id": delivery_id,
            "status": delivery.status if delivery else "missing",
        }


@shared_task
def plan_escalation_task(order_id: str, hotel_id: str) -> dict:
    """
    Планирование в фоне: создание заказа не должно ждать, пока движок разложит
    ступени и достучится до брокера.
    """
    from apps.orders.services import order_queryset

    from .services import plan_escalation, run_due_steps

    with tenant_context(hotel_id):
        order = order_queryset().filter(pk=order_id).first()
        if order is None:
            return {"order_id": order_id, "planned": 0}
        planned = plan_escalation(order)
        # Ступень «сразу» не ждёт круга службы расписания: она и есть первое
        # уведомление отделу, и минута задержки здесь — минута без ответа гостю.
        run_due_steps(planned)
        return {"order_id": order_id, "planned": len(planned)}
