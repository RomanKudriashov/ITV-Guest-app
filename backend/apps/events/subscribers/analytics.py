"""
Подписчик аналитики — каркас.

Считает счётчики в Redis. Настоящая аналитика (витрины, когорты, выгрузки)
приедет отдельным прогоном; здесь важно только зафиксировать шов: аналитика
питается событиями, а не ходит в оперативные таблицы.
"""

from __future__ import annotations

import logging

import redis
from django.conf import settings

from apps.events.bus import (
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    Event,
    subscribe,
)

logger = logging.getLogger(__name__)


def _counter_key(event: Event, suffix: str = "") -> str:
    day = event.occurred_at[:10]
    return f"analytics:{event.hotel_id}:{day}:{event.name}{suffix}"


@subscribe(ORDER_CREATED, ORDER_STATUS_CHANGED, ORDER_CANCELLED)
def increment_counters(event: Event) -> None:
    try:
        client = redis.Redis.from_url(settings.REDIS_URL)
        pipe = client.pipeline()
        pipe.incr(_counter_key(event))
        if event.name == ORDER_CREATED:
            pipe.incrby(_counter_key(event, ":revenue"), int(event.payload.get("total", 0)))
        pipe.expire(_counter_key(event), 60 * 60 * 24 * 90)
        pipe.execute()
    except Exception:  # noqa: BLE001 — счётчики не критичны для операции
        logger.warning("Счётчик аналитики не обновлён (%s)", event.name, exc_info=True)
