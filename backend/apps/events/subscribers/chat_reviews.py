"""
Подписчики чата и отзывов: разносят события по WS и уведомляют персонал через
существующие каналы, без новой инфраструктуры.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.core.context import tenant_context
from apps.events.bus import CHAT_MESSAGE, REVIEW_LOW, Event, subscribe

logger = logging.getLogger("apps.chat")


def _ws_send(group: str, message: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(group, message)


@subscribe(CHAT_MESSAGE)
def broadcast_chat_message(event: Event) -> None:
    """Толкаем в WS-группу треда — гость и персонал реконсилируют снимок сами."""
    thread_id = event.payload.get("thread_id")
    if not thread_id:
        return
    _ws_send(
        f"chat.{event.hotel_id}.{thread_id}",
        {"type": "chat.event", "event": event.name, "thread_id": thread_id},
    )


@subscribe(CHAT_MESSAGE)
def notify_staff_of_guest_message(event: Event) -> None:
    """Сообщение гостя → уведомление отделу треда через каналы уведомлений."""
    if event.payload.get("author_type") != "guest":
        return
    _notify_point(
        event,
        "chat.guest_message",
        {
            "room_number": event.payload.get("room") or None,
            "preview": event.payload.get("preview", ""),
        },
    )


@subscribe(REVIEW_LOW)
def notify_manager_of_low_rating(event: Event) -> None:
    """Низкая оценка → уведомление менеджеру отдела (service recovery)."""
    _notify_point(
        event,
        "review.low",
        {
            "rating": event.payload.get("rating"),
            "number": event.payload.get("number"),
            "comment": event.payload.get("comment", ""),
            "room_number": event.payload.get("room") or None,
        },
        target_level="manager",
    )


def channels_for_point(point_id, *, target_level: str | None = None) -> list:
    """
    Куда уходит событие отдела.

    Без уровня — во все каналы отдела. С уровнем — ТОЛЬКО в личные каналы
    сотрудников этого уровня на этой точке. Раньше уровень принимался и
    нигде не использовался: низкая оценка, адресованная руководителю, уходила
    во все каналы отдела, то есть в общий чат кухни, где её читает вся смена.
    """
    from apps.accounts.models import StaffAssignment
    from apps.notifications.models import NotificationChannel

    active = NotificationChannel.objects.filter(is_active=True)
    if not target_level:
        return list(active.filter(execution_point_id=point_id))

    user_ids = StaffAssignment.objects.filter(
        execution_point_id=point_id, level=target_level, is_active=True
    ).values_list("user_id", flat=True)
    return list(active.filter(user_id__in=list(user_ids)))


def _notify_point(
    event: Event, code: str, values: dict, *, target_level: str | None = None
) -> None:
    """
    Отправка через существующие каналы уведомлений: каналы отдела треда/заявки.
    Текст — из справочника событий (`apps/notifications/events.py`).
    """
    from apps.hotels.models import Hotel
    from apps.notifications import events as notification_events

    point_id = event.payload.get("execution_point_id")
    if not point_id:
        return

    with tenant_context(event.hotel_id):
        channels = channels_for_point(point_id, target_level=target_level)
        if not channels:
            return
        from apps.notifications.channels.adapters import get_adapter

        language = Hotel.objects.get(pk=event.hotel_id).default_language
        message = notification_events.render(
            code, values, language=language, default_language=language
        )
        for channel in channels:
            try:
                get_adapter(channel.type).send(message, channel.config or {})
            except Exception:  # noqa: BLE001 — канал не должен ронять чат/отзыв
                logger.warning("Уведомление не доставлено в канал %s", channel.pk, exc_info=True)
