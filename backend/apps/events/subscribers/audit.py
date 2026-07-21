"""
Подписчик аудита: каждое событие шины оседает в AuditLog.

Пишем синхронно и в той же базе: аудит должен быть настолько же доступен,
насколько доступны сами данные, а очередь добавила бы окно, в котором событие
уже произошло, а следа ещё нет.
"""

from __future__ import annotations

import logging

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.events.bus import (
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    Event,
    subscribe,
)

logger = logging.getLogger(__name__)


@subscribe(ORDER_CREATED, ORDER_STATUS_CHANGED, ORDER_CANCELLED)
def write_audit_entry(event: Event) -> None:
    order_id = event.payload.get("order_id")
    with tenant_context(event.hotel_id):
        AuditLog.objects.create(
            hotel_id=event.hotel_id,
            actor_type=event.actor_type,
            actor_id=event.actor_id,
            action=event.name,
            object_type="order",
            object_id=order_id,
            payload=event.payload,
        )
