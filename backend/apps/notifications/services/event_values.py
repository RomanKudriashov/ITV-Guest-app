"""
ДАННЫЕ СОБЫТИЯ — ОДИН ПУТЬ ДЛЯ ОТПРАВКИ И ДЛЯ ПРЕВЬЮ.

Подстановки собираются здесь и только здесь: подписчик шины зовёт те же
функции, что и превью. Превью, собранное своим путём, однажды разошлось бы с
отправкой — и показывало бы сообщение, которого не придёт никогда. Урок
партии 7: превью оформления было наполовину выдумано, и человек не мог
отличить выдуманное от настоящего.

ПРИМЕР — ИЗ ДАННЫХ ОТЕЛЯ, НЕ ПРИДУМАННЫЙ. `find_example` берёт последний
настоящий случай: заявку, отмену, сообщение гостя, отзыв. Нет такого случая —
примера нет, и экран говорит это прямо, а не рисует «Заявку №123 из номера 101».

Значения, зависящие от языка (отдел, состав заявки, причина), лежат словарём
по языкам: данные события пишутся в журнал один раз, а текст собирается на
языке каждого получателя.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime

from apps.core.context import require_hotel_id
from apps.core.fields import translate
from apps.notifications import events as registry


@dataclasses.dataclass(slots=True)
class Example:
    values: dict
    point_id: str | None
    # Откуда пример — экран называет его словами: «заявка №412 от 14:05».
    source: dict
    order: object | None = None


def _per_language(build) -> dict:
    return {language: build(language) for language in registry.LANGUAGES}


# --- Подстановки -------------------------------------------------------------


def chat_message(payload: dict) -> dict:
    return {
        "room_number": payload.get("room") or None,
        "preview": payload.get("preview", ""),
    }


def review_low(payload: dict) -> dict:
    return {
        "rating": payload.get("rating"),
        "number": payload.get("number"),
        "comment": payload.get("comment", ""),
        "room_number": payload.get("room") or None,
    }


def order_cancelled(order, comment: str = "") -> dict:
    """Отмена: номер, комната, отдел, состав, причина — на языке получателя."""
    hotel_language = order.hotel.default_language

    def summary(language: str) -> str:
        lines = []
        for line in order.items.all():
            title = translate(line.title_snapshot, language)
            lines.append(f"{line.quantity}× {title}" if line.quantity > 1 else title)
        return "\n".join(lines)

    reason_key = f"cancel_reason.{order.cancel_reason}" if order.cancel_reason else ""
    return {
        "number": order.number,
        "room": (
            _per_language(
                lambda language: registry.word(
                    "room", language, hotel_language, n=order.room.number
                )
            )
            if order.room_id
            else ""
        ),
        "point": _per_language(
            lambda language: translate(order.execution_point.title, language)
            or order.execution_point.code
        ),
        "summary": _per_language(summary),
        "reason": (
            _per_language(lambda language: registry.word(reason_key, language, hotel_language))
            if reason_key in registry.WORDS
            else None
        ),
        "comment": comment or "",
    }


def cancel_comment(order) -> str:
    """Уточнение к отмене живёт в журнале статусов, рядом с тем, кто отменил."""
    from apps.orders.models import OrderStatusChange

    change = (
        OrderStatusChange.objects.filter(order=order, to_status__is_cancelled=True)
        .order_by("-created_at")
        .first()
    )
    return change.comment if change else ""


def brand(payload: dict) -> dict:
    return {
        "version": payload.get("version"),
        "draft_name": payload.get("draft_name") or None,
        "delay_seconds": payload.get("delay_seconds"),
    }


def undelivered(*, event_code: str, channel_title: str, subject: str, error: str) -> dict:
    try:
        title = registry.get(event_code).title
    except LookupError:
        title = {registry.FALLBACK_LANGUAGE: event_code}
    return {"event": dict(title), "channel": channel_title, "subject": subject, "error": error}


# --- Живые примеры -----------------------------------------------------------


def find_example(code: str) -> Example | None:
    finder = _FINDERS.get(code)
    return finder(code) if finder else None


def _at(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _latest_order(**filters):
    from apps.orders.models import Order

    return (
        Order.objects.filter(children__isnull=True, **filters)
        .select_related("status", "execution_point", "room", "hotel")
        .order_by("-created_at")
        .first()
    )


def _overdue(code: str) -> Example | None:
    order = _latest_order()
    if order is None:
        return None
    return Example(
        values={},
        point_id=str(order.execution_point_id),
        source={"kind": "order", "number": order.number, "at": _at(order.created_at)},
        order=order,
    )


def _cancelled(code: str) -> Example | None:
    order = _latest_order(status__is_cancelled=True)
    if order is None:
        return None
    return Example(
        values=order_cancelled(order, cancel_comment(order)),
        point_id=str(order.execution_point_id),
        source={
            "kind": "cancelled_order",
            "number": order.number,
            "at": _at(order.closed_at or order.updated_at),
        },
        order=order,
    )


def _chat(code: str) -> Example | None:
    from apps.chat.models import ChatMessage

    message = (
        ChatMessage.objects.filter(author_type="guest")
        .select_related("thread__room")
        .order_by("-created_at")
        .first()
    )
    if message is None:
        return None
    thread = message.thread
    room = thread.room.number if thread.room_id else ""
    return Example(
        # Те же поля, что кладёт в событие чат (`chat/services/threads.py`).
        values=chat_message({"room": room, "preview": message.body[:120]}),
        point_id=str(thread.execution_point_id) if thread.execution_point_id else None,
        source={"kind": "chat_message", "room": room, "at": _at(message.created_at)},
    )


def _review(code: str) -> Example | None:
    from apps.hotels.models import Hotel
    from apps.reviews.models import Review
    from apps.reviews.services import review_points

    hotel = Hotel.objects.get(pk=require_hotel_id())
    threshold = getattr(hotel, "review_low_threshold", 2)
    review = (
        Review.objects.filter(rating__lte=threshold)
        .select_related("order__room")
        .order_by("-created_at")
        .first()
    )
    if review is None:
        return None
    order = review.order
    return Example(
        # Те же поля, что кладёт в событие отзыв (`reviews/services/reviews.py`).
        values=review_low(
            {
                "number": order.number,
                "rating": review.rating,
                "comment": review.comment[:200],
                "room": order.room.number if order.room_id else "",
            }
        ),
        # Отзыв о заказе из двух заведений разбирает часть, не агрегат.
        point_id=review_points(order)[0],
        source={
            "kind": "review",
            "number": order.number,
            "rating": review.rating,
            "at": _at(review.created_at),
        },
    )


def _brand(code: str) -> Example | None:
    """
    Пример — настоящее событие оформления из журнала действий. Если такого
    ещё не было, берём последнюю опубликованную версию и ГОВОРИМ, что она
    опубликована не по расписанию: задержки у неё нет, и в тексте будет прочерк.
    """
    from apps.core.models import AuditLog
    from apps.hotels.services.brand_versions import current_published

    entry = (
        AuditLog.objects.filter(hotel_id=require_hotel_id(), action=code)
        .order_by("-created_at")
        .first()
    )
    if entry is not None:
        return Example(
            values=brand(entry.payload or {}),
            point_id=None,
            source={
                "kind": "brand_event",
                "version": (entry.payload or {}).get("version"),
                "at": _at(entry.created_at),
            },
        )
    version = current_published()
    if version is None:
        return None
    return Example(
        values=brand({"version": version.number, "draft_name": version.name}),
        point_id=None,
        source={"kind": "brand_version", "version": version.number, "at": _at(version.created_at)},
    )


def _undelivered(code: str) -> Example | None:
    from apps.notifications.models import EventDelivery, NotificationLog, NotificationStatus

    event_failure = (
        EventDelivery.objects.filter(status=NotificationStatus.FAILED)
        .exclude(record__code=code)
        .select_related("record")
        .order_by("-updated_at")
        .first()
    )
    escalation_failure = (
        NotificationLog.objects.filter(status=NotificationStatus.FAILED, channel__isnull=False)
        .select_related("channel")
        .order_by("-updated_at")
        .first()
    )
    candidates = []
    if event_failure is not None:
        candidates.append(
            (
                event_failure.updated_at,
                undelivered(
                    event_code=event_failure.record.code,
                    channel_title=event_failure.channel_title,
                    subject=event_failure.subject,
                    error=event_failure.error,
                ),
                event_failure.channel_title,
            )
        )
    if escalation_failure is not None:
        candidates.append(
            (
                escalation_failure.updated_at,
                undelivered(
                    event_code="order.overdue",
                    channel_title=escalation_failure.channel.title,
                    subject=escalation_failure.subject,
                    error=escalation_failure.error,
                ),
                escalation_failure.channel.title,
            )
        )
    if not candidates:
        return None
    at, values, channel_title = max(candidates, key=lambda item: item[0])
    return Example(
        values=values,
        point_id=None,
        source={"kind": "failed_delivery", "channel": channel_title, "at": _at(at)},
    )


_FINDERS = {
    "order.overdue": _overdue,
    "order.cancelled": _cancelled,
    "chat.guest_message": _chat,
    "review.low": _review,
    "brand.published_on_schedule": _brand,
    "brand.published_late": _brand,
    "brand.schedule_failed": _brand,
    "notification.undelivered": _undelivered,
}
