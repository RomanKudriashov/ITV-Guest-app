"""
Событийная шина.

Два правила, которые делают её надёжной:

  1. Событие эмитится ПОСЛЕ КОММИТА (transaction.on_commit). Иначе подписчик
     (или воркер, которого он разбудил) увидит заказ, которого в базе ещё нет,
     а при откате транзакции — заказ, которого не будет никогда.
  2. Падение подписчика не роняет операцию. Заказ уже создан; то, что счётчик
     аналитики не инкрементнулся, — не повод отдавать гостю 500.

Локальные подписчики вызываются в процессе; кросс-процессная доставка идёт
через Redis pub/sub (его слушают, например, другие инстансы и трекер).
"""

from __future__ import annotations

import dataclasses
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone as dt_timezone
from typing import Any, Callable

from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

Subscriber = Callable[["Event"], None]

_subscribers: dict[str, list[Subscriber]] = defaultdict(list)


# --- Каталог событий -------------------------------------------------------
# Имена — часть контракта между сервисами, поэтому константами, а не строками
# по месту вызова.

ORDER_CREATED = "order.created"
# Принятие заказа раньше было неотличимо от любой другой смены статуса, а
# для эскалации это ключевой момент: с него подъём прекращается.
ORDER_ACCEPTED = "order.accepted"
ORDER_STATUS_CHANGED = "order.status_changed"
ORDER_CANCELLED = "order.cancelled"
CHAT_MESSAGE = "chat.message"
REVIEW_LOW = "review.low"
# Отзыв оставлен (любой оценки) и старт гостевой сессии — нужны аналитике,
# которая питается событиями, а не оперативными таблицами.
REVIEW_CREATED = "review.created"
SESSION_STARTED = "session.started"


@dataclasses.dataclass(slots=True)
class Event:
    name: str
    hotel_id: str | None
    payload: dict[str, Any]
    id: str = dataclasses.field(default_factory=lambda: str(uuid.uuid4()))
    occurred_at: str = dataclasses.field(
        default_factory=lambda: datetime.now(dt_timezone.utc).isoformat()
    )
    actor_type: str = "system"
    actor_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


def subscribe(*names: str) -> Callable[[Subscriber], Subscriber]:
    """
    Регистрация подписчика:

        @subscribe(ORDER_CREATED, ORDER_STATUS_CHANGED)
        def push_to_tracker(event): ...
    """

    def decorator(func: Subscriber) -> Subscriber:
        for name in names:
            _subscribers[name].append(func)
        return func

    return decorator


def emit(
    name: str,
    payload: dict[str, Any],
    *,
    hotel_id: Any = None,
    actor_type: str = "system",
    actor_id: Any = None,
    immediate: bool = False,
) -> Event:
    """
    Ставит событие в очередь на публикацию после коммита текущей транзакции.

    immediate=True — только для кода вне транзакции (управляющие команды,
    воркеры). В обработчиках запросов всегда False.
    """
    from apps.core.context import current_hotel_id

    event = Event(
        name=name,
        hotel_id=str(hotel_id) if hotel_id else (str(current_hotel_id() or "") or None),
        payload=payload,
        actor_type=actor_type,
        actor_id=str(actor_id) if actor_id else None,
    )

    if immediate:
        _dispatch(event)
    else:
        transaction.on_commit(lambda: _dispatch(event))
    return event


def _dispatch(event: Event) -> None:
    _publish_to_redis(event)
    for handler in _subscribers.get(event.name, []):
        try:
            handler(event)
        except Exception:  # noqa: BLE001 — подписчик не должен ронять операцию
            logger.exception(
                "Подписчик %s упал на событии %s (%s)",
                getattr(handler, "__qualname__", handler),
                event.name,
                event.id,
            )


def _publish_to_redis(event: Event) -> None:
    try:
        import redis

        client = redis.Redis.from_url(settings.REDIS_URL)
        channel = f"{settings.EVENT_BUS_CHANNEL_PREFIX}.{event.name}"
        client.publish(channel, json.dumps(event.to_dict(), ensure_ascii=False))
    except Exception:  # noqa: BLE001 — Redis может быть недоступен, шина деградирует мягко
        logger.warning("Не удалось опубликовать %s в Redis", event.name, exc_info=True)


def registered_subscribers() -> dict[str, list[str]]:
    """Интроспекция — используется health-эндпоинтом и тестами."""
    return {
        name: [getattr(h, "__qualname__", repr(h)) for h in handlers]
        for name, handlers in _subscribers.items()
    }
