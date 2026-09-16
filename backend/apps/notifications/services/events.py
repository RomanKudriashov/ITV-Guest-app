"""
Событие отелю: записать, кому-то разослать, записать, чем кончилось.

Одна дверь для всего, что уходит человеку помимо эскалации заказа: сообщение
гостя, низкая оценка, события оформления. До неё у каждого места была своя
рассылка без журнала — отказ канала оставался только в логе приложения, а
«некому было отправить» не оставлялось нигде.

ПОРЯДОК ВАЖЕН. Сначала факт в журнал, потом попытки отправки: журнал
первичен и переживёт и упавший канал, и отсутствующего адресата.

ОТКАЗ КАНАЛА НЕ ОТМЕНЯЕТ СОБЫТИЯ И НЕ РОНЯЕТ ВЫЗЫВАЮЩЕГО. Сообщение гостя
отправлено и без Telegram, публикация оформления состоялась и без почты.
"""

from __future__ import annotations

import logging
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.notifications import events as registry
from apps.notifications.channels import adapters
from apps.notifications.channels.base import ChannelError
from apps.notifications.models import (
    EventDelivery,
    EventRecord,
    NotificationChannel,
    NotificationStatus,
)

logger = logging.getLogger("apps.notifications")


# --- Адресаты --------------------------------------------------------------


def channels_for_audience(audience: str, point_id=None) -> list[NotificationChannel]:
    """
    Каналы адресата. Разрешаются В МОМЕНТ ОТПРАВКИ: состав смены меняется.

      * отдел — все активные каналы отдела;
      * старшие / руководители — ТОЛЬКО личные каналы сотрудников этого уровня
        на этой точке. Раньше уровень принимался и не использовался, и оценка
        для руководителя уходила в общий чат кухни;
      * отель — общие каналы: без отдела И без сотрудника.
    """
    from apps.accounts.models import StaffAssignment

    active = NotificationChannel.objects.filter(is_active=True)

    if audience == registry.AUDIENCE_HOTEL:
        return list(active.filter(execution_point__isnull=True, user__isnull=True))

    if not point_id:
        # Событие отдела без отдела — адресовать некого, и это видно в журнале.
        return []

    if audience == registry.AUDIENCE_POINT:
        return list(active.filter(execution_point_id=point_id))

    level = {
        registry.AUDIENCE_LEAD: StaffAssignment.Level.LEAD,
        registry.AUDIENCE_MANAGER: StaffAssignment.Level.MANAGER,
    }.get(audience)
    if level is None:
        return []
    user_ids = StaffAssignment.objects.filter(
        execution_point_id=point_id, level=level, is_active=True
    ).values_list("user_id", flat=True)
    return list(active.filter(user_id__in=list(user_ids)))


# --- Язык ------------------------------------------------------------------


def recipient_language(channel: NotificationChannel, hotel) -> str:
    """
    Язык, на котором собирается текст для этого канала — ЯЗЫК ПОЛУЧАТЕЛЯ.

    Личный канал принадлежит человеку, и его язык задан в профиле (у 22 из 24
    сотрудников стенда). Общий канал отдела — чат, где читают многие; у него
    одного получателя нет, и текст идёт на языке отеля. Язык, на котором
    справочник не говорит, заменяется языком отеля, а не выдаёт пустое письмо.
    """
    if channel.user_id:
        own = _base_language(getattr(channel.user, "language", ""))
        if own in registry.LANGUAGES:
            return own
    hotel_language = _base_language(getattr(hotel, "default_language", ""))
    return hotel_language if hotel_language in registry.LANGUAGES else registry.FALLBACK_LANGUAGE


def _base_language(value: str) -> str:
    """«en-US» → «en»: справочник говорит на языках, а не на их вариантах."""
    return (value or "").strip().lower().replace("_", "-").split("-")[0]


# --- Рассылка --------------------------------------------------------------


def notify(code: str, values: dict, *, point_id=None, dedupe_key: str | None = None):
    """
    Записать событие и разослать его адресату по умолчанию.

    Возвращает запись журнала или None, если такое событие уже записано
    (повтор события шины).
    """
    from apps.hotels.models import Hotel

    spec = registry.get(code)
    hotel = Hotel.objects.get(pk=require_hotel_id())

    try:
        with transaction.atomic():
            record = EventRecord.objects.create(
                hotel_id=hotel.pk,
                code=code,
                execution_point_id=point_id or None,
                payload=_jsonable(values),
                dedupe_key=dedupe_key or f"{code}:{uuid.uuid4()}",
            )
    except IntegrityError:
        logger.info("Событие %s уже записано — повтор пропущен", dedupe_key)
        return None

    channels = channels_for_audience(spec.audience, point_id)
    if not channels:
        record.outcome = EventRecord.Outcome.NO_RECIPIENTS
        record.save(update_fields=["outcome", "updated_at"])
        return record

    sent = failed = 0
    for channel in channels:
        if _deliver(record, channel, values, hotel):
            sent += 1
        else:
            failed += 1

    record.outcome = (
        EventRecord.Outcome.SENT
        if not failed
        else EventRecord.Outcome.FAILED
        if not sent
        else EventRecord.Outcome.PARTIAL
    )
    record.save(update_fields=["outcome", "updated_at"])
    return record


def _deliver(record: EventRecord, channel: NotificationChannel, values: dict, hotel) -> bool:
    language = recipient_language(channel, hotel)
    message = registry.render(
        record.code, values, language=language, default_language=hotel.default_language
    )
    delivery = EventDelivery.objects.create(
        hotel_id=hotel.pk,
        record=record,
        channel=channel,
        recipient_id=channel.user_id,
        channel_type=channel.type,
        channel_title=channel.title[:128],
        language=language,
        subject=message.subject[:255],
        body=message.body,
        status=NotificationStatus.SCHEDULED,
        attempts=1,
    )
    try:
        reference = adapters.get_adapter(channel.type).send(message, channel.config or {})
    except ChannelError as exc:
        delivery.status = NotificationStatus.FAILED
        delivery.error = exc.detail[:2000]
    except Exception as exc:  # noqa: BLE001 — канал не вправе уронить событие
        logger.warning("Канал %s не принял событие %s", channel.pk, record.code, exc_info=True)
        delivery.status = NotificationStatus.FAILED
        delivery.error = f"{type(exc).__name__}: {exc}"[:2000]
    else:
        delivery.status = NotificationStatus.SENT
        delivery.sent_at = timezone.now()
        delivery.error = str(reference)[:2000]
    delivery.save(update_fields=["status", "error", "sent_at", "updated_at"])
    return delivery.status == NotificationStatus.SENT


def _jsonable(values: dict) -> dict:
    """Данные события — в журнал как есть, но только то, что ляжет в JSON."""
    out = {}
    for key, value in (values or {}).items():
        out[key] = value if isinstance(value, (str, int, float, bool)) or value is None else str(value)
    return out
