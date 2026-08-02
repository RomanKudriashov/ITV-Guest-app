"""
Стенд GRMS для тестов: эмулятор iRidi + коннектор без сокета.

Исполнитель здесь НАСТОЯЩИЙ (`connector/itv_connector/executor.py`). Подменён
только WS-клиент: задания забираются из той же группы Channels, в которую пишет
backend. Аутентификация и маршрутизация сокета проверяются отдельно
(tests/test_grms_connector.py) — поднимать ради них вторую ASGI-петлю в каждом
тесте незачем.
"""

from __future__ import annotations

import asyncio
import threading

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone

from apps.core.context import tenant_context
from apps.grms.consumers import group_name
from apps.grms.emulator import serve_in_thread
from apps.hotels.models import OnPremNode
from apps.hotels.onprem import register_node
from itv_connector.executor import Endpoint, execute


class FakeConnectorRuntime:
    def __init__(self, hotel_id: str, endpoints: dict):
        self.hotel_id = hotel_id
        self.endpoints = endpoints
        self.seen: list[dict] = []
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._ready = threading.Event()

    def start(self):
        self._thread.start()
        assert self._ready.wait(timeout=10), "коннектор не подписался на группу"

    def stop(self):
        """
        Останов сигнальным конвертом, а не отменой receive().

        Отменять `receive()` у channels_redis нельзя: уже снятое с очереди
        сообщение теряется, и тест падает с TTL_EXPIRED на исправной трубе.
        """
        async_to_sync(get_channel_layer().group_send)(
            group_name(self.hotel_id),
            {"type": "connector.dispatch", "envelope": {"__stop__": True}, "reply_to": ""},
        )
        self._thread.join(timeout=10)

    def _run(self):
        async_to_sync(self._pump)()

    async def _pump(self):
        # Своя петля — свой экземпляр слоя: соединение Redis привязано к петле.
        from channels_redis.core import RedisChannelLayer

        layer = RedisChannelLayer(hosts=settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"])
        channel = await layer.new_channel()
        await layer.group_add(group_name(self.hotel_id), channel)
        self._ready.set()

        while True:
            message = await layer.receive(channel)
            envelope = message["envelope"]
            if envelope.get("__stop__"):
                return
            self.seen.append(envelope)
            response = await asyncio.get_running_loop().run_in_executor(
                None, execute, envelope, self.endpoints
            )
            await layer.send(message["reply_to"], {"type": "connector.reply", "payload": response})


def wire(hotel, *, latency_range=(0.35, 0.55)):
    """Поднять эмулятор и коннектор для отеля. Возвращает (контекст, финализатор)."""
    httpd, emulator, port = serve_in_thread(latency_range=latency_range)

    node, _key = register_node(hotel, name="grms-box", purpose="grms")
    with tenant_context(hotel):
        # Без свежей отметки транспорт сразу ответит CONNECTOR_OFFLINE.
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now())

    runtime = FakeConnectorRuntime(
        str(hotel.pk), {"iridi": Endpoint(base_url=f"http://127.0.0.1:{port}", timeout_ms=2000)}
    )
    runtime.start()

    def finish():
        runtime.stop()
        httpd.shutdown()

    return {"hotel": hotel, "emulator": emulator, "connector": runtime, "port": port}, finish
