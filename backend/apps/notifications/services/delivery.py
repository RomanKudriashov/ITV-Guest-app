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

КОГДА И КТО ОТПРАВЛЯЕТ. Ступень «сразу» исполняет задача планирования; более
поздние ступени — служба расписания (`ScheduledJob`), одна на весь проект:
её видно в консоли, её задания переживают перезапуск брокера. Отправку ступень
отдаёт Celery ПОСЛЕ КОММИТА — служба держит блокировку строки задания, и
ждать под ней чужой API нельзя. Точность ступени — круг службы, до минуты.
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

from apps.notifications import events as notification_events
from apps.notifications.channels.adapters import get_adapter
from apps.notifications.channels.base import ChannelError, RenderedMessage
from apps.notifications.models import (
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
    TargetKind,
)

logger = logging.getLogger("apps.notifications")

# Текст по умолчанию живёт в справочнике событий (`apps/notifications/events.py`,
# `order.overdue`) — на четырёх языках. Шаблон канала, если отель его задал,
# по-прежнему важнее.
OVERDUE_EVENT = "order.overdue"
# Вид задания службы расписания для ступени эскалации.
STEP_JOB_KIND = "notification.escalation_step"


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
    channel: NotificationChannel | None,
    order: Order,
    step: EscalationStep | None,
    language: str,
    event_templates: dict | None = None,
) -> RenderedMessage:
    """
    Текст ступени на языке ПОЛУЧАТЕЛЯ.

    Порядок: шаблон канала на языке получателя → текст события, заданный
    отелем, на том же языке → текст справочника на том же языке → шаблон
    канала на языке отеля → текст события на языке отеля. Текст на ДРУГОМ
    языке язык получателя не перебивает: англоязычный старший смены получает
    английский текст справочника, а не русский шаблон, написанный для
    остальных. Шаблон канала — точнее события: он написан для этого чата.
    """
    default_language = order.hotel.default_language
    spec = notification_events.get(OVERDUE_EVENT)
    if event_templates is None:
        from apps.notifications.services.event_settings import effective

        event_templates = effective(OVERDUE_EVENT).templates

    channel_templates = (channel.templates or {}) if channel else {}
    template = _complete(channel_templates.get(language))
    if not template:
        template = _complete((event_templates or {}).get(language))
    if not template and language in notification_events.LANGUAGES:
        template = {
            "subject": spec.text("subject", language, default_language),
            "body": spec.text("body", language, default_language),
        }
    if not template:
        template = _complete(channel_templates.get(default_language))
    if not template:
        template = notification_events.pick_template(
            spec, event_templates or {}, default_language, default_language
        )

    context = _message_context(order, step, language)
    return RenderedMessage(
        subject=_fill(template.get("subject", ""), context),
        body=_fill(template.get("body", ""), context),
    )


def _complete(template) -> dict | None:
    if template and (template.get("subject") or template.get("body")):
        return template
    return None


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
        "room": (
            notification_events.word(
                "room", language, order.hotel.default_language, n=order.room.number
            )
            if order.room_id
            else ""
        ),
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

    from apps.notifications.services.event_settings import is_enabled

    if not is_enabled(OVERDUE_EVENT):
        # Отель выключил уведомления о просрочке — планировать нечего.
        return []

    rule = rule_for_order(order)
    if rule is None:
        return []

    steps = list(rule.steps.all().order_by("sort_order", "delay_minutes"))
    if not steps:
        return []

    from apps.core.services import scheduler

    now = timezone.now()
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

        if scheduled_for > now:
            # «Когда» — дело службы расписания. Ступень, срок которой уже
            # пришёл, исполняет `run_due_steps` сразу, не дожидаясь круга.
            scheduler.schedule(
                kind=STEP_JOB_KIND,
                run_at=scheduled_for,
                payload={"log_id": str(log.pk), "order_id": str(order.pk)},
            )

    return planned


def run_due_steps(planned: Iterable[NotificationLog], *, now=None) -> int:
    """Исполнить ступени, чей срок уже пришёл: «сразу» и опоздавшие к планированию."""
    now = now or timezone.now()
    done = 0
    for log in planned:
        if log.scheduled_for <= now:
            execute_step(log.pk)
            done += 1
    return done


def run_step_job(job) -> dict:
    """
    Обработчик службы расписания. Ничего не отправляет сам: ступень ставит
    доставки в Celery после коммита, и блокировка задания не ждёт каналов.
    """
    log = execute_step(job.payload.get("log_id"))
    if log is None:
        return {"skipped": True, "reason": "log_gone"}
    if log.status in (NotificationStatus.CANCELLED, NotificationStatus.SKIPPED):
        return {"skipped": True, "reason": log.status, "detail": log.error[:200]}
    return {"status": log.status, "deliveries": log.deliveries.count()}


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
    from apps.notifications.services.event_settings import effective

    overdue = effective(OVERDUE_EVENT)
    if not overdue.enabled:
        # Выключили между планированием и сроком — решение отеля действует сразу.
        log.status = NotificationStatus.CANCELLED
        log.error = "Отель выключил уведомления о просрочке"
        log.save(update_fields=["status", "error", "updated_at"])
        return log

    if escalation_should_stop(order):
        # ГЛАВНАЯ проверка: задача могла сработать ровно в тот момент,
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

    from apps.notifications.services.events import recipient_language

    queued = []
    for channel in channels:
        # Язык — у каждого получателя свой: старший смены с английским в профиле
        # получает английский текст, общий чат кухни — текст на языке отеля.
        language = recipient_language(channel, order.hotel)
        message = render_message(channel, order, log.step, language, overdue.templates)
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
        queued.append(str(delivery.pk))

    _dispatch(queued, order.hotel_id)
    log.status = NotificationStatus.SENT
    log.sent_at = timezone.now()
    log.save(update_fields=["status", "sent_at", "updated_at"])
    return log


def _dispatch(log_ids: list[str], hotel_id) -> None:
    """
    В Celery — после коммита: ступень исполняется и внутри транзакции службы
    расписания, и воркер, получивший задачу раньше коммита, не нашёл бы
    доставку и не отправил бы ничего.
    """
    if not log_ids:
        return
    from apps.notifications.tasks import deliver_notification

    def send() -> None:
        for log_id in log_ids:
            deliver_notification.delay(log_id, str(hotel_id))

    transaction.on_commit(send)


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
        _report_failed(log)
        return log

    log.status = NotificationStatus.SENT
    log.sent_at = timezone.now()
    log.error = reference[:2000]
    log.save(update_fields=["status", "sent_at", "error", "updated_at"])
    return log


def mark_delivery_failed(log_id, error: str) -> None:
    """Вызывается Celery, когда ретраи исчерпаны."""
    updated = NotificationLog.objects.filter(
        pk=log_id, status=NotificationStatus.SCHEDULED
    ).update(status=NotificationStatus.FAILED, error=str(error)[:2000])
    if updated:
        _report_failed(NotificationLog.objects.select_related("channel").get(pk=log_id))


def _report_failed(log: NotificationLog) -> None:
    """Просрочка, которая не дошла, — тоже событие: иначе её не узнает никто."""
    from apps.notifications.services.events import report_undelivered

    report_undelivered(
        event_code=OVERDUE_EVENT,
        channel_id=log.channel_id,
        channel_title=log.channel.title if log.channel_id else "",
        subject=log.subject,
        error=log.error,
        source_key=f"escalation:{log.pk}",
    )


# --- Остановка -------------------------------------------------------------


def cancel_pending(order: Order, reason: str = "Заказ взят в работу") -> int:
    """
    Гасит запланированные ступени и отзывает задачи.

    Задания службы расписания гасятся тихо, без записи в журнал действий:
    принятая заявка — не решение человека отменить публикацию, и тысяча таких
    строк в день заслонила бы настоящие отмены.

    Отзыв задач Celery (поставленных до перехода на службу расписания) —
    best-effort. Настоящая гарантия — проверка состояния в execute_step.
    """
    from apps.core.models import ScheduledJob

    pending = list(
        NotificationLog.objects.filter(order=order, status=NotificationStatus.SCHEDULED)
    )
    if not pending:
        return 0

    NotificationLog.objects.filter(pk__in=[log.pk for log in pending]).update(
        status=NotificationStatus.CANCELLED, error=reason
    )
    ScheduledJob.objects.filter(
        kind=STEP_JOB_KIND,
        status=ScheduledJob.Status.PENDING,
        payload__order_id=str(order.pk),
    ).update(status=ScheduledJob.Status.CANCELLED, result={"reason": reason})
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
