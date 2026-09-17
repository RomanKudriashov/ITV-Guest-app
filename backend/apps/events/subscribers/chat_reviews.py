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
    """Сообщение гостя → каналы отдела треда (адресат — из справочника событий)."""
    if event.payload.get("author_type") != "guest":
        return
    from apps.notifications.services import event_values

    _notify(event, "chat.guest_message", event_values.chat_message(event.payload))


@subscribe(REVIEW_LOW)
def notify_manager_of_low_rating(event: Event) -> None:
    """Низкая оценка → руководителю отдела (service recovery), не всей смене."""
    from apps.notifications.services import event_values

    # По уведомлению на каждую часть заказа: у заказа из двух заведений
    # руководитель кухни и руководитель бара узнают каждый о своём.
    values = event_values.review_low(event.payload)
    points = event.payload.get("execution_point_ids") or [event.payload.get("execution_point_id")]
    for point_id in points:
        _notify(event, "review.low", values, point_id=point_id)


def _notify(event: Event, code: str, values: dict, *, point_id=None) -> None:
    """
    Через общую дверь уведомлений: факт в журнал, затем рассылка адресату из
    настройки события. Событие без отдела тоже пишется — с итогом «некому
    отправить», а не молча пропадает. Выключенное отелем — не пишется.

    Уведомление не вправе уронить чат или отзыв: сбой здесь остаётся в логе,
    а сообщение гостя уже доставлено в тред.
    """
    from apps.notifications.services.events import notify

    point = point_id or event.payload.get("execution_point_id") or None
    try:
        with tenant_context(event.hotel_id):
            notify(
                code,
                values,
                point_id=point,
                dedupe_key=f"{code}:{event.id}" + (f":{point}" if point_id else ""),
            )
    except Exception:  # noqa: BLE001
        logger.warning("Уведомление %s не записано", code, exc_info=True)
