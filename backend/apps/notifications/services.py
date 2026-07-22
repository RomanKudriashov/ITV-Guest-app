"""
Движок эскалации.

Три гарантии, ради которых он написан (docs/notifications-api-contract.md):

1. **Ступень заново проверяет состояние заказа в момент исполнения.** Отмена
   запланированной задачи — оптимизация, а не гарантия: задача может сработать
   ровно в ту секунду, когда официант жмёт «Принять». Поэтому перед отправкой
   ступень перечитывает заказ и гасит себя, если он уже принят или завершён.
2. **Идемпотентность.** У каждой отправки есть ключ дедупликации с уникальным
   индексом: повтор Celery-задачи не даёт второго сообщения.
3. **Недоступность канала не задевает заказ.** Отправка — отдельная задача с
   ретраями; упавший Telegram оставляет `failed` в журнале и ничего больше.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Iterable

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import StaffAssignment
from apps.core.context import require_hotel_id
from apps.core.fields import translate
from apps.orders.models import Order

from .channels.adapters import get_adapter
from .channels.base import ChannelError, RenderedMessage
from .models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
    TargetKind,
)

logger = logging.getLogger("apps.notifications")

DEFAULT_TEMPLATE = {
    "subject": "Заявка №{{number}} — {{point}}",
    "body": "{{room}}\n{{summary}}\n{{comment}}",
}


# --- Состояние заказа ------------------------------------------------------


def escalation_should_stop(order: Order) -> bool:
    """
    Причина остановить подъём: заказ взяли в работу, увели со стартового
    статуса или закрыли. Любого из трёх достаточно — эскалация существует
    ровно до момента, когда за заявку кто-то отвечает.
    """
    return (
        order.accepted_at is not None
        or order.status.is_terminal
        or not order.status.is_initial
    )


# --- Правила ---------------------------------------------------------------


def rule_for_order(order: Order) -> EscalationRule | None:
    """Правило точки исполнения, иначе — правило отеля по умолчанию."""
    own = (
        EscalationRule.objects.filter(execution_point_id=order.execution_point_id, is_active=True)
        .prefetch_related("steps__channel")
        .first()
    )
    if own is not None:
        return own
    return (
        EscalationRule.objects.filter(execution_point__isnull=True, is_active=True)
        .prefetch_related("steps__channel")
        .first()
    )


def resolve_channels(step: EscalationStep, order: Order) -> list[NotificationChannel]:
    """
    Цели разрешаются В МОМЕНТ ИСПОЛНЕНИЯ, а не при планировании: за пятнадцать
    минут состав смены успевает поменяться, и уведомлять надо тех, кто на месте
    сейчас.
    """
    active = NotificationChannel.objects.filter(is_active=True)

    if step.target_kind == TargetKind.CHANNEL:
        return list(active.filter(pk=step.channel_id)) if step.channel_id else []

    if step.target_kind == TargetKind.POINT:
        return list(active.filter(execution_point_id=order.execution_point_id))

    levels = {
        TargetKind.LEAD: [StaffAssignment.Level.LEAD],
        TargetKind.MANAGER: [StaffAssignment.Level.MANAGER],
    }.get(step.target_kind)
    if not levels:
        return []

    user_ids = StaffAssignment.objects.filter(
        execution_point_id=order.execution_point_id, level__in=levels, is_active=True
    ).values_list("user_id", flat=True)
    return list(active.filter(user_id__in=list(user_ids)))


# --- Рендер ----------------------------------------------------------------


def render_message(
    channel: NotificationChannel | None, order: Order, step: EscalationStep | None, language: str
) -> RenderedMessage:
    template = (channel.templates or {}).get(language) if channel else None
    if not template:
        template = (channel.templates or {}).get(order.hotel.default_language) if channel else None
    template = template or DEFAULT_TEMPLATE

    context = _message_context(order, step, language)
    return RenderedMessage(
        subject=_fill(template.get("subject", ""), context),
        body=_fill(template.get("body", ""), context),
    )


def _fill(template: str, context: dict[str, str]) -> str:
    """
    Подстановка ровно известных плейсхолдеров, без eval и без Django-шаблонов:
    шаблоны редактирует отель, и исполнять его текст как код — плохая идея.
    """
    result = str(template or "")
    for key, value in context.items():
        result = result.replace("{{" + key + "}}", value)
    return result.strip()


def _message_context(order: Order, step: EscalationStep | None, language: str) -> dict[str, str]:
    lines = []
    for line in order.items.all():
        title = translate(line.title_snapshot, language)
        lines.append(f"{line.quantity}× {title}" if line.quantity > 1 else title)
    for entry in order.field_values or []:
        lines.append(f"{translate(entry.get('label'), language)}: {entry.get('display', '')}")

    return {
        "number": str(order.number),
        "room": f"Номер {order.room.number}" if order.room_id else "",
        "point": translate(order.execution_point.title, language) or order.execution_point.code,
        "summary": "\n".join(lines),
        "comment": order.comment or "",
        "status": translate(order.status.title, language),
        "total": "" if order.total is None else f"{order.total / 100:.2f} {order.currency}",
        "step": step.title if step and step.title else "",
        "delay": str(step.delay_minutes) if step else "0",
    }


# --- Планирование ----------------------------------------------------------


def plan_escalation(order: Order) -> list[NotificationLog]:
    """
    Создаёт запись на каждую ступень и ставит отложенные задачи.

    Записи создаются заранее (а не в момент срабатывания), потому что они же
    служат состоянием: по ним гасится эскалация при принятии и по ним же
    работает дедупликация.
    """
    if not settings.NOTIFICATIONS_ENABLED:
        return []

    rule = rule_for_order(order)
    if rule is None:
        return []

    steps = list(rule.steps.all().order_by("sort_order", "delay_minutes"))
    if not steps:
        return []

    from .tasks import run_escalation_step

    planned: list[NotificationLog] = []
    for index, step in enumerate(steps):
        scheduled_for = order.created_at + timedelta(minutes=step.delay_minutes)
        log = _get_or_create_log(
            order=order,
            rule=rule,
            step=step,
            channel=None,
            parent=None,
            step_index=index,
            dedupe_key=f"{order.pk}:step:{step.pk}",
            scheduled_for=scheduled_for,
        )
        if log is None:
            continue
        planned.append(log)

        countdown = max(0, int((scheduled_for - timezone.now()).total_seconds()))
        async_result = run_escalation_step.apply_async(
            args=(str(log.pk), str(order.hotel_id)), countdown=countdown
        )
        NotificationLog.objects.filter(pk=log.pk).update(celery_task_id=async_result.id or "")

    return planned


def _get_or_create_log(**kwargs) -> NotificationLog | None:
    """None — запись уже есть; значит, планирование повторилось и делать нечего."""
    dedupe_key = kwargs["dedupe_key"]
    try:
        with transaction.atomic():
            return NotificationLog.objects.create(
                hotel_id=require_hotel_id(),
                status=NotificationStatus.SCHEDULED,
                target_kind=kwargs["step"].target_kind if kwargs.get("step") else "",
                **kwargs,
            )
    except IntegrityError:
        logger.info("Уведомление %s уже запланировано — пропускаю", dedupe_key)
        return None


# --- Исполнение ступени ----------------------------------------------------


def execute_step(log_id, *, now=None) -> NotificationLog:
    """
    Срабатывание ступени. Вызывается Celery-задачей и НАПРЯМУЮ из тестов —
    поэтому здесь нет ничего, что зависело бы от реального хода времени.
    """
    log = (
        NotificationLog.objects.select_related("order__status", "order__execution_point", "step")
        .filter(pk=log_id)
        .first()
    )
    if log is None:
        return None

    # Идемпотентность: отработавшую ступень повтор задачи не трогает.
    if log.status != NotificationStatus.SCHEDULED:
        logger.info("Ступень %s уже в статусе %s — повтор проигнорирован", log.pk, log.status)
        return log

    order = log.order
    if escalation_should_stop(order):
        # ГЛАВНАЯ проверка прогона: задача могла сработать ровно в тот момент,
        # когда заказ приняли, и отмена задачи не успела бы.
        log.status = NotificationStatus.CANCELLED
        log.accepted_at_send = True
        log.error = "Заказ уже в работе — эскалация не нужна"
        log.save(update_fields=["status", "accepted_at_send", "error", "updated_at"])
        return log

    channels = resolve_channels(log.step, order) if log.step_id else []
    if not channels:
        # Молчаливое «никому не ушло» недопустимо: это видно в журнале.
        log.status = NotificationStatus.SKIPPED
        log.error = "Для этой ступени не нашлось активных каналов"
        log.save(update_fields=["status", "error", "updated_at"])
        return log

    language = order.hotel.default_language
    from .tasks import deliver_notification

    for channel in channels:
        message = render_message(channel, order, log.step, language)
        delivery = _get_or_create_log(
            order=order,
            rule_id=log.rule_id,
            step=log.step,
            channel=channel,
            parent=log,
            step_index=log.step_index,
            dedupe_key=f"{order.pk}:step:{log.step_id}:channel:{channel.pk}",
            scheduled_for=log.scheduled_for,
        )
        if delivery is None:
            continue
        NotificationLog.objects.filter(pk=delivery.pk).update(
            subject=message.subject, body=message.body
        )
        deliver_notification.delay(str(delivery.pk), str(order.hotel_id))

    log.status = NotificationStatus.SENT
    log.sent_at = timezone.now()
    log.save(update_fields=["status", "sent_at", "updated_at"])
    return log


# --- Отправка --------------------------------------------------------------


def send_delivery(log_id) -> NotificationLog:
    """
    Одна отправка в один канал. Бросает ChannelError, чтобы Celery повторил;
    неповторяемые ошибки помечает `failed` сразу.
    """
    log = NotificationLog.objects.select_related("channel", "order").filter(pk=log_id).first()
    if log is None or log.channel_id is None:
        return log
    if log.status != NotificationStatus.SCHEDULED:
        return log

    adapter = get_adapter(log.channel.type)
    message = RenderedMessage(subject=log.subject, body=log.body)

    # Попытку считаем до отправки: упавшая попытка тоже попытка. Обновляем и
    # объект в памяти — иначе вызывающий получит устаревший счётчик.
    log.attempts += 1
    NotificationLog.objects.filter(pk=log.pk).update(attempts=log.attempts)
    try:
        reference = adapter.send(message, log.channel.config or {})
    except ChannelError as exc:
        log.error = exc.detail[:2000]
        if exc.retryable:
            log.save(update_fields=["error", "updated_at"])
            raise
        log.status = NotificationStatus.FAILED
        log.save(update_fields=["status", "error", "updated_at"])
        return log

    log.status = NotificationStatus.SENT
    log.sent_at = timezone.now()
    log.error = reference[:2000]
    log.save(update_fields=["status", "sent_at", "error", "updated_at"])
    return log


def mark_delivery_failed(log_id, error: str) -> None:
    """Вызывается Celery, когда ретраи исчерпаны."""
    NotificationLog.objects.filter(pk=log_id, status=NotificationStatus.SCHEDULED).update(
        status=NotificationStatus.FAILED, error=str(error)[:2000]
    )


# --- Остановка -------------------------------------------------------------


def cancel_pending(order: Order, reason: str = "Заказ взят в работу") -> int:
    """
    Гасит запланированные ступени и отзывает задачи.

    Отзыв — best-effort: Celery не гарантирует, что задача не успела уйти в
    исполнение. Настоящая гарантия — проверка состояния в execute_step.
    """
    pending = list(
        NotificationLog.objects.filter(order=order, status=NotificationStatus.SCHEDULED)
    )
    if not pending:
        return 0

    NotificationLog.objects.filter(pk__in=[log.pk for log in pending]).update(
        status=NotificationStatus.CANCELLED, error=reason
    )
    _revoke([log.celery_task_id for log in pending if log.celery_task_id])
    return len(pending)


def _revoke(task_ids: Iterable[str]) -> None:
    ids = [task_id for task_id in task_ids if task_id]
    if not ids:
        return
    try:
        from config.celery import app

        app.control.revoke(ids)
    except Exception:  # noqa: BLE001 — брокер может быть недоступен, это не критично
        logger.warning("Не удалось отозвать задачи эскалации: %s", ids, exc_info=True)


# --- Пробная отправка ------------------------------------------------------


def send_test_message(channel: NotificationChannel, language: str | None = None) -> dict:
    """
    Проверка канала из CMS. Настраивать канал вслепую и узнавать про опечатку
    в токене из первой настоящей заявки — плохой способ.
    """
    adapter = get_adapter(channel.type)
    message = RenderedMessage(
        subject="Проверка канала",
        body=f"Канал «{channel.title}» настроен верно.",
    )
    try:
        reference = adapter.send(message, channel.config or {})
    except ChannelError as exc:
        return {"ok": False, "detail": exc.detail}
    return {"ok": True, "detail": reference}
