"""
Отправка задания коннектору и ожидание ответа.

Корреляция — по requestID и только по нему. Не по порядку ответов и не по
«последнему пришедшему»: у одного отеля одновременно живут команды из разных
номеров, а буфер ответа в самом скрипте iRidi — модульный синглтон. Цена
ошибки здесь — состояние ЧУЖОГО канала, показанное гостю как своё.

TTL отдельно от таймаута — требование ТЗ §6 «старые команды после
восстановления связи не выполняются». Без него связь, вернувшаяся через минуту,
вывалила бы в номер очередь накопленных команд: гость нажал свет, ушёл, а свет
включился сам через десять минут.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.grms import adapter
from apps.grms.consumers import group_name

logger = logging.getLogger(__name__)


def _offline(request_id: str) -> dict:
    return {
        "type": "connector.response",
        "requestID": request_id,
        "ok": False,
        "error": {"code": adapter.CONNECTOR_OFFLINE, "message": "коннектор не подключён"},
        "duration_ms": 0,
    }


def node_is_online(hotel) -> bool:
    """
    «Онлайн» = узел отмечался недавно. Дозвониться до него мы не можем в
    принципе, поэтому других определений тут быть не может.
    """
    from apps.core.context import tenant_context
    from apps.hotels.models import OnPremNode

    with tenant_context(hotel):
        node = (
            OnPremNode.objects.filter(is_revoked=False)
            .filter(purpose__in=[OnPremNode.Purpose.GRMS, OnPremNode.Purpose.BOTH])
            .order_by("-last_seen_at")
            .first()
        )
    # Ровно `is_online` модели, а не своя копия порога: у OnPremNode уже есть
    # и порог, и корректная обработка «ни разу не отмечался». Своя копия здесь
    # успела родить ошибку — `seconds_since_seen or ...` считал ТОЛЬКО ЧТО
    # подключившийся узел (0 секунд — falsy) офлайном.
    return node is not None and node.is_online


async def asend(hotel_id, envelope: dict, *, ttl_ms: int) -> dict:
    """
    Асинхронная отправка. Возвращает ответ коннектора либо синтетический
    отказ — исключений не бросает: вызывающий ждёт ответ по requestID.
    """
    request_id = str(envelope.get("requestID"))
    layer = get_channel_layer()
    reply_to = await layer.new_channel()

    await layer.group_send(
        group_name(hotel_id),
        {"type": "connector.dispatch", "envelope": envelope, "reply_to": reply_to},
    )

    try:
        # Ждём РОВНО TTL: позже ответ применять уже нельзя.
        message = await _receive_within(layer, reply_to, ttl_ms / 1000)
    except TimeoutError:
        return {
            "type": "connector.response",
            "requestID": request_id,
            "ok": False,
            "error": {"code": adapter.TTL_EXPIRED, "message": f"нет ответа за {ttl_ms} мс"},
            "duration_ms": ttl_ms,
        }
    return message["payload"]


async def _receive_within(layer, channel: str, seconds: float):
    import asyncio

    return await asyncio.wait_for(layer.receive(channel), timeout=seconds)


def send(hotel, envelope: dict, *, ttl_ms: int | None = None) -> dict:
    """
    Синхронная обёртка для прикладного кода.

    Проверка «узел онлайн» ДО отправки, а не по таймауту: задания на
    отключённый узел не копятся (контракт G0 §5), и ждать TTL, когда уже
    известно, что слушать некому, — значит держать гостя пять секунд ради
    заведомо известного ответа.
    """
    request_id = str(envelope.get("requestID"))
    if not node_is_online(hotel):
        return _offline(request_id)

    ttl = ttl_ms or int(envelope.get("ttl_ms") or 5000)
    return async_to_sync(asend)(str(hotel.pk), envelope, ttl_ms=ttl)
