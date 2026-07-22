"""
Подписчики чата и отзывов: разносят события по WS и уведомляют персонал через
существующие каналы (прогон 6), без новой инфраструктуры.
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
    """Сообщение гостя → уведомление отделу треда через каналы прогона 6."""
    if event.payload.get("author_type") != "guest":
        return
    _notify_point(
        event,
        subject=f"Сообщение из номера {event.payload.get('room', '')}",
        body=event.payload.get("preview", ""),
    )


@subscribe(REVIEW_LOW)
def notify_manager_of_low_rating(event: Event) -> None:
    """Низкая оценка → уведомление менеджеру отдела (service recovery)."""
    _notify_point(
        event,
        subject=f"Низкая оценка ({event.payload.get('rating')}/5) · заявка №{event.payload.get('number')}",
        body=event.payload.get("comment", "") or "Без комментария",
        target_level="manager",
    )


def _notify_point(event: Event, *, subject: str, body: str, target_level: str | None = None) -> None:
    """
    Отправка через существующие каналы уведомлений: каналы отдела треда/заявки.
    Переиспользуем адаптеры и журнал прогона 6, ничего нового не заводя.
    """
    from apps.notifications.channels.base import RenderedMessage
    from apps.notifications.models import NotificationChannel

    point_id = event.payload.get("execution_point_id")
    if not point_id:
        return

    with tenant_context(event.hotel_id):
        channels = NotificationChannel.objects.filter(
            execution_point_id=point_id, is_active=True
        )
        if not channels.exists():
            return
        from apps.notifications.channels.adapters import get_adapter

        message = RenderedMessage(subject=subject, body=body)
        for channel in channels:
            try:
                get_adapter(channel.type).send(message, channel.config or {})
            except Exception:  # noqa: BLE001 — канал не должен ронять чат/отзыв
                logger.warning("Уведомление не доставлено в канал %s", channel.pk, exc_info=True)
