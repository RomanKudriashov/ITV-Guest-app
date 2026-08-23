"""
Канал коннектора: backend ↔ Local Connector.

Направление связи обратное: коробка стоит за NAT во внутренней сети отеля, и
облако до неё дозвониться не может. Поэтому соединение устанавливает узел, а
backend только пушит в уже открытый сокет.

Аутентификация — ключом узла, тем же самым, что уже используется в
`/api/v1/onprem/heartbeat`. Отдельного механизма не заводим: ключ уже
выдаётся, хэшируется, отзывается и перевыпускается в R6, и второй способ
представиться означал бы вторую поверхность для утечки.
"""

from __future__ import annotations

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

logger = logging.getLogger(__name__)

CLOSE_UNAUTHORIZED = 4401

# Имя группы, в которую backend пушит задания для конкретного отеля.
def group_name(hotel_id) -> str:
    return f"onprem.{hotel_id}"


@database_sync_to_async
def _authenticate(key: str):
    """
    Ключ → узел. Попутно отмечаем «жив»: подключение — такой же признак
    жизни, как и heartbeat, и расходиться они не должны.
    """
    from apps.hotels.services.onprem import touch

    node = touch(key)
    if node is None:
        return None
    return {
        "node_id": str(node.pk),
        "hotel_id": str(node.hotel_id),
        "hotel": node.hotel.subdomain,
        "purpose": node.purpose,
    }


@database_sync_to_async
def _touch(key: str, version: str) -> None:
    from apps.hotels.services.onprem import touch

    touch(key, version=version)


@database_sync_to_async
def _remember_endpoints(hotel_id: str, endpoints) -> None:
    from apps.grms.services import liveness

    liveness.remember_endpoints(hotel_id, endpoints)


@database_sync_to_async
def _forget_endpoints(hotel_id: str) -> None:
    from apps.grms.services import liveness

    liveness.forget(hotel_id)


class ConnectorConsumer(AsyncJsonWebsocketConsumer):
    """
    Держит соединение с одним узлом и работает мостом в обе стороны.

    Соответствие «requestID → куда вернуть ответ» живёт В ЭКЗЕМПЛЯРЕ: обе
    стороны обмена проходят через один и тот же консьюмер, и выносить это
    в общее хранилище незачем.
    """

    async def connect(self):
        key = self._key()
        if not key:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return

        node = await _authenticate(key)
        if node is None:
            # Один ответ и на «нет такого ключа», и на «ключ отозван»:
            # разница между ними — подсказка тому, кто ключи перебирает.
            await self.close(code=CLOSE_UNAUTHORIZED)
            return

        self.node = node
        self.key = key
        self.pending: dict[str, str] = {}
        self.group = group_name(node["hotel_id"])

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        await self.send_json(
            {
                "type": "connector.hello",
                "node_id": node["node_id"],
                "hotel": node["hotel"],
                "heartbeat_interval_s": 60,
                "server_time": timezone.now().isoformat(),
            }
        )
        logger.info("коннектор подключён: узел=%s отель=%s", node["node_id"], node["hotel"])

    def _key(self) -> str:
        for raw_name, raw_value in self.scope.get("headers") or []:
            if raw_name == b"authorization":
                value = raw_value.decode()
                if value.lower().startswith("bearer "):
                    return value[7:].strip()
        return ""

    async def disconnect(self, code):
        group = getattr(self, "group", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)
        node = getattr(self, "node", None)
        if node:
            # Узел отключился — прежние пробы endpoint'ов больше ничего не
            # значат. Оставить их значило бы отвечать гостю «связь есть» по
            # замеру, сделанному до обрыва.
            await _forget_endpoints(node["hotel_id"])

    async def receive_json(self, content, **kwargs):
        kind = content.get("type")

        if kind == "connector.heartbeat":
            # ПЕРЕПОДПИСКА НА ГРУППУ НА КАЖДОМ HEARTBEAT.
            #
            # Членство в группе Channels живёт в Redis с TTL (`group_expiry`,
            # по умолчанию сутки) и продлевается только новым `group_add`.
            # Соединение при этом не рвётся: коннектор держит сокет неделями,
            # heartbeat'ы идут ВВЕРХ и доходят — а `group_send` вниз через
            # сутки уходит в никуда. Снаружи это выглядит так: узел «онлайн»,
            # эмулятор отвечает, а бэкенд считает связь мёртвой и отдаёт
            # STATE_UNREADABLE. Лечилось пересозданием контейнеров, потому что
            # переподключение заново добавляло канал в группу.
            #
            # Продлеваем сами: heartbeat приходит раз в минуту, `group_add`
            # идемпотентен и стоит одну команду Redis. Поднять `group_expiry`
            # было бы половиной решения — большой TTL всё равно однажды
            # истечёт на долгоживущем соединении.
            await self.channel_layer.group_add(self.group, self.channel_name)
            await _touch(self.key, content.get("version") or "")
            # Коннектор прикладывает результат ЛОКАЛЬНОЙ пробы каждого
            # endpoint'а. До G5 это поле никто не читал; гостевой признак
            # доступности собирается в том числе из него.
            await _remember_endpoints(self.node["hotel_id"], content.get("endpoints"))
            return

        if kind == "connector.response":
            request_id = str(content.get("requestID") or "")
            reply_to = self.pending.pop(request_id, None)
            if reply_to is None:
                # Ответ, которого никто не ждёт: истёк TTL и запрос уже
                # закрыт. Молча роняем — применять его к состоянию нельзя,
                # это ровно тот «поздний ответ», от которого защищает TTL.
                logger.info("поздний ответ коннектора, requestID=%s", request_id)
                return
            await self.channel_layer.send(reply_to, {"type": "connector.reply", "payload": content})

    async def connector_dispatch(self, message):
        """Задание от backend → в сокет узла."""
        envelope = message["envelope"]
        self.pending[str(envelope.get("requestID"))] = message["reply_to"]
        await self.send_json(envelope)
