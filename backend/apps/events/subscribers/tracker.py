"""
Подписчик realtime-трекера: разносит события заказа по WebSocket-группам.

Две аудитории у одного события:
  * точка исполнения (кухня) — видит новый заказ на доске;
  * гость — видит статус своего заказа.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.events.bus import (
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    Event,
    subscribe,
)

logger = logging.getLogger(__name__)


def _send(group: str, message: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        logger.debug("Channel layer не сконфигурирован — пропускаю %s", group)
        return
    async_to_sync(layer.group_send)(group, message)


@subscribe(ORDER_CREATED, ORDER_STATUS_CHANGED, ORDER_CANCELLED)
def broadcast_order_event(event: Event) -> None:
    payload = event.payload
    hotel_id = event.hotel_id
    order_id = payload.get("order_id")
    execution_point_id = payload.get("execution_point_id")

    message = {
        "type": "order.event",  # -> метод order_event у consumer'а
        "event": event.name,
        "event_id": event.id,
        "occurred_at": event.occurred_at,
        "data": payload,
    }

    if execution_point_id:
        _send(f"tracker.{hotel_id}.{execution_point_id}", message)
    if order_id:
        _send(f"order.{hotel_id}.{order_id}", message)
