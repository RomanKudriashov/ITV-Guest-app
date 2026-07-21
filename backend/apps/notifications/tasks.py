"""
Celery-задачи эскалации.

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


@shared_task(
    bind=True,
    max_retries=5,
    acks_late=True,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
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
            raise self.retry(exc=exc) from exc

        return {"log_id": log_id, "status": log.status if log else "missing"}


@shared_task
def plan_escalation_task(order_id: str, hotel_id: str) -> dict:
    """
    Планирование в фоне: создание заказа не должно ждать, пока движок разложит
    ступени и достучится до брокера.
    """
    from apps.orders.services import order_queryset

    from .services import plan_escalation

    with tenant_context(hotel_id):
        order = order_queryset().filter(pk=order_id).first()
        if order is None:
            return {"order_id": order_id, "planned": 0}
        return {"order_id": order_id, "planned": len(plan_escalation(order))}
