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

ОТПРАВЛЯЕТ CELERY, ПОСЛЕ КОММИТА. Здесь только факт, адресаты и готовые тексты;
сам запрос к каналу — задача с повторами. Вызывающий не ждёт чужой API и не
держит свою транзакцию: публикация оформления вызывается службой расписания
под блокировкой строки задания, и Telegram с таймаутом в десять секунд держал
бы эту блокировку и весь круг по флоту.

ВЫКЛЮЧЕННОЕ СОБЫТИЕ НЕ ПИШЕТСЯ. Отель решил, что оно ему не нужно, — журнал
не заполняется фактами, которых никто не собирался отправлять.
"""

from __future__ import annotations

import logging
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.notifications import events as registry
from apps.notifications.channels import adapters
from apps.notifications.channels.base import ChannelError, RenderedMessage
from apps.notifications.models import (
    EventDelivery,
    EventRecord,
    NotificationChannel,
    NotificationStatus,
)

logger = logging.getLogger("apps.notifications")


# --- Адресаты --------------------------------------------------------------


UNDELIVERED = "notification.undelivered"


def channels_for_audience(
    audience: str, point_id=None, *, channel_id=None, channel_types=(), user_id=None
) -> list[NotificationChannel]:
    """
    Каналы адресата. Разрешаются В МОМЕНТ ОТПРАВКИ: состав смены меняется.

      * отдел — все активные каналы отдела;
      * старшие / руководители — ТОЛЬКО личные каналы сотрудников этого уровня
        на этой точке. Раньше уровень принимался и не использовался, и оценка
        для руководителя уходила в общий чат кухни;
      * отель — общие каналы: без отдела И без сотрудника;
      * канал — один выбранный отелем канал.

    `channel_types` сужает любой адресат до выбранных видов каналов.
    """
    from apps.accounts.models import StaffAssignment

    active = NotificationChannel.objects.filter(is_active=True).select_related("user")
    if channel_types:
        active = active.filter(type__in=list(channel_types))

    if audience == "channel":
        return list(active.filter(pk=channel_id)) if channel_id else []

    if audience == registry.AUDIENCE_HOTEL:
        return list(active.filter(execution_point__isnull=True, user__isnull=True))

    if audience == registry.AUDIENCE_USER:
        # Поимённый адресат: личные каналы одного человека. Нет адресата или у
        # него нет личного канала — никому не шлём, и это видно в журнале, а не
        # разливается по отделу.
        return list(active.filter(user_id=user_id)) if user_id else []

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


def notify(
    code: str,
    values: dict,
    *,
    point_id=None,
    user_id=None,
    dedupe_key: str | None = None,
    exclude_channel_ids=(),
):
    """
    Записать событие и поставить его доставки в очередь.

    Возвращает запись журнала или None, если событие выключено отелем или уже
    записано (повтор события шины).
    """
    from django.conf import settings

    from apps.hotels.models import Hotel
    from apps.notifications.services import event_settings

    registry.get(code)
    if not settings.NOTIFICATIONS_ENABLED:
        return None
    setting = event_settings.effective(code)
    if not setting.enabled:
        logger.debug("Событие %s выключено отелем — не пишем и не шлём", code)
        return None
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

    excluded = {str(pk) for pk in exclude_channel_ids}
    channels = [
        channel
        for channel in channels_for_audience(
            setting.audience,
            point_id,
            channel_id=setting.channel_id,
            channel_types=setting.channel_types,
            user_id=user_id,
        )
        if str(channel.pk) not in excluded
    ]
    if not channels:
        record.outcome = EventRecord.Outcome.NO_RECIPIENTS
        record.save(update_fields=["outcome", "updated_at"])
        return record

    deliveries = [
        _prepare(record, channel, values, hotel, setting.templates) for channel in channels
    ]
    _dispatch([delivery.pk for delivery in deliveries], hotel.pk)
    return record


def render_for(code: str, values: dict, channel, hotel, templates: dict) -> tuple[str, RenderedMessage]:
    """Язык и текст для одного канала — общий путь отправки и превью."""
    language = recipient_language(channel, hotel)
    message = registry.render(
        code,
        values,
        language=language,
        default_language=hotel.default_language,
        templates=templates,
    )
    return language, message


def _prepare(record: EventRecord, channel: NotificationChannel, values: dict, hotel, templates) -> EventDelivery:
    language, message = render_for(record.code, values, channel, hotel, templates)
    return EventDelivery.objects.create(
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
    )


def _dispatch(delivery_ids, hotel_id) -> None:
    """
    В очередь — ПОСЛЕ КОММИТА: воркер, получивший задачу раньше, не нашёл бы
    доставку и молча ничего не отправил бы.
    """
    from apps.notifications.tasks import deliver_event

    ids = [str(pk) for pk in delivery_ids]

    def send() -> None:
        for delivery_id in ids:
            deliver_event.delay(delivery_id, str(hotel_id))

    transaction.on_commit(send)


# --- Доставка (вызывается задачей Celery) ----------------------------------


def send_event_delivery(delivery_id) -> EventDelivery | None:
    """
    Одна доставка в один канал. Повторяемую ошибку канала бросает наверх —
    Celery повторит; неповторяемую и неожиданную записывает сразу.

    Блокировок здесь нет: запрос к каналу идёт вне транзакции. Повтор задачи
    отсекается статусом — отправленное второй раз не уходит.
    """
    delivery = (
        EventDelivery.objects.select_related("channel", "record").filter(pk=delivery_id).first()
    )
    if delivery is None or delivery.status != NotificationStatus.SCHEDULED:
        return delivery
    if delivery.channel is None or not delivery.channel.is_active:
        _finish(delivery, NotificationStatus.FAILED, "Канал удалён или выключен до отправки")
        return delivery

    delivery.attempts += 1
    EventDelivery.objects.filter(pk=delivery.pk).update(attempts=delivery.attempts)
    message = RenderedMessage(subject=delivery.subject, body=delivery.body)
    try:
        reference = adapters.get_adapter(delivery.channel.type).send(
            message, delivery.channel.config or {}
        )
    except ChannelError as exc:
        if exc.retryable:
            EventDelivery.objects.filter(pk=delivery.pk).update(error=exc.detail[:2000])
            raise
        _finish(delivery, NotificationStatus.FAILED, exc.detail)
    except Exception as exc:  # noqa: BLE001 — канал не вправе уронить событие
        logger.warning(
            "Канал %s не принял событие %s", delivery.channel_id, delivery.record.code, exc_info=True
        )
        _finish(delivery, NotificationStatus.FAILED, f"{type(exc).__name__}: {exc}")
    else:
        _finish(delivery, NotificationStatus.SENT, str(reference))
    return delivery


def mark_event_delivery_failed(delivery_id, error: str) -> None:
    """Повторы исчерпаны."""
    delivery = (
        EventDelivery.objects.select_related("record")
        .filter(pk=delivery_id, status=NotificationStatus.SCHEDULED)
        .first()
    )
    if delivery is not None:
        _finish(delivery, NotificationStatus.FAILED, error)


def _finish(delivery: EventDelivery, status: str, detail: str) -> None:
    delivery.status = status
    delivery.error = str(detail or "")[:2000]
    if status == NotificationStatus.SENT:
        delivery.sent_at = timezone.now()
    delivery.save(update_fields=["status", "error", "sent_at", "updated_at"])
    refresh_outcome(delivery.record_id)
    if status == NotificationStatus.FAILED:
        report_undelivered(
            event_code=delivery.record.code,
            channel_id=delivery.channel_id,
            channel_title=delivery.channel_title,
            subject=delivery.subject,
            error=delivery.error,
            source_key=f"event:{delivery.pk}",
        )


def refresh_outcome(record_id) -> None:
    """
    Итог события — по всем его доставкам. Строка факта блокируется на время
    пересчёта (без запросов наружу): две доставки, закончившиеся одновременно,
    иначе записали бы итог в обратном порядке, и «разослано» стало бы
    «рассылается».
    """
    with transaction.atomic():
        record = EventRecord.objects.select_for_update().filter(pk=record_id).first()
        if record is None:
            return
        statuses = list(record.deliveries.values_list("status", flat=True))
        if not statuses:
            return
        if NotificationStatus.SCHEDULED in statuses:
            outcome = EventRecord.Outcome.PENDING
        elif all(status == NotificationStatus.SENT for status in statuses):
            outcome = EventRecord.Outcome.SENT
        elif NotificationStatus.SENT in statuses:
            outcome = EventRecord.Outcome.PARTIAL
        else:
            outcome = EventRecord.Outcome.FAILED
        if record.outcome != outcome:
            record.outcome = outcome
            record.save(update_fields=["outcome", "updated_at"])


def report_undelivered(
    *, event_code: str, channel_id, channel_title: str, subject: str, error: str, source_key: str
) -> None:
    """
    Отправка не дошла после всех попыток — сказать администратору отеля.

    Никогда — о недоставленном «не доставлено»: сломанный общий канал иначе
    порождал бы сообщения о самом себе без конца. И никогда — в тот же канал,
    который только что не принял сообщение.
    """
    if event_code == UNDELIVERED:
        return
    try:
        title = registry.get(event_code).title
    except LookupError:
        title = {registry.FALLBACK_LANGUAGE: event_code}
    try:
        notify(
            UNDELIVERED,
            {"event": title, "channel": channel_title, "subject": subject, "error": error},
            dedupe_key=f"{UNDELIVERED}:{source_key}",
            exclude_channel_ids=[channel_id] if channel_id else [],
        )
    except Exception:  # noqa: BLE001 — сообщение о сбое не вправе создать второй сбой
        logger.warning("Не удалось сообщить о недоставке %s", source_key, exc_info=True)


def _jsonable(values: dict) -> dict:
    """Данные события — в журнал как есть, но только то, что ляжет в JSON."""
    out = {}
    for key, value in (values or {}).items():
        if isinstance(value, dict):
            out[key] = {str(lang): str(text) for lang, text in value.items()}
        elif isinstance(value, (str, int, float, bool)) or value is None:
            out[key] = value
        else:
            out[key] = str(value)
    return out
