"""
Клиент коннектора: исходящее соединение с backend, heartbeat, авто-reconnect.

Направление связи обратное привычному, и это не выбор стиля: коробка стоит за
NAT во внутренней сети отеля, снаружи её попросту нет. Облако не может
«позвонить» на объект, поэтому звонит объект и держит трубку.

Из того же следует смысл слова «офлайн»: узел офлайн — это «перестал
отмечаться», а не «мы не смогли до него дозвониться». Дозвониться мы не можем
никогда.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from .config import ConnectorConfig
from .executor import execute

log = logging.getLogger("itv.connector")

# Пауза перед повтором растёт, но не бесконечно: узел обязан вернуться сам,
# без выезда инженера, поэтому потолок небольшой.
RECONNECT_MIN_S = 1.0
RECONNECT_MAX_S = 30.0


def _backoff(attempt: int, node_key: str) -> float:
    """
    Экспоненциальная пауза с джиттером.

    Джиттер обязателен: после сетевого сбоя на объекте оживают все узлы разом,
    и без разброса они пришли бы на backend одной волной — ровно в тот момент,
    когда он и так восстанавливается.
    """
    base = min(RECONNECT_MIN_S * (2 ** max(attempt - 1, 0)), RECONNECT_MAX_S)
    # Джиттер выводим из ключа узла, а не из random: разные узлы получают
    # разный сдвиг, но поведение одного узла воспроизводимо в отладке.
    spread = (hash(node_key) % 1000) / 1000.0
    return base * (0.5 + 0.5 * spread)


class Connector:
    def __init__(self, config: ConnectorConfig):
        self.config = config
        self._sem = asyncio.Semaphore(config.max_concurrent_requests)
        self._stopping = False

    async def run_forever(self) -> None:
        attempt = 0
        while not self._stopping:
            try:
                await self._session()
                attempt = 0  # успешная сессия обнуляет счётчик
            except Exception as exc:  # соединение — ненадёжная среда по определению
                attempt += 1
                delay = _backoff(attempt, self.config.node_key)
                log.warning("соединение потеряно (%s); повтор через %.1f с", exc, delay)
                await asyncio.sleep(delay)

    async def _session(self) -> None:
        import websockets  # импорт здесь: исполнителю websockets не нужен

        headers = {"Authorization": f"Bearer {self.config.node_key}"}
        async with websockets.connect(
            self.config.backend_url, additional_headers=headers, ping_interval=20
        ) as socket:
            log.info("подключились к backend: %s", self.config.backend_url)
            heartbeat = asyncio.create_task(self._heartbeat(socket))
            try:
                async for message in socket:
                    asyncio.create_task(self._dispatch(socket, message))
            finally:
                heartbeat.cancel()

    async def _heartbeat(self, socket) -> None:
        """
        Отметка «жив» + доступность endpoint'ов.

        Доступность проверяет САМ коннектор и присылает результат: backend
        физически не может её проверить, а показывать гостю рабочие кнопки,
        не зная, жив ли iRidi, — прямой запрет ТЗ §6.
        """
        while True:
            probes = {}
            for name in self.config.endpoints:
                started = time.monotonic()
                ok = await self._probe(name)
                probes[name] = {
                    "reachable": ok,
                    "latency_ms": int((time.monotonic() - started) * 1000),
                }
            await socket.send(
                json.dumps(
                    {
                        "type": "connector.heartbeat",
                        "version": self.config.version,
                        "endpoints": probes,
                    }
                )
            )
            await asyncio.sleep(self.config.heartbeat_interval_s)

    async def _probe(self, name: str) -> bool:
        """Дешёвая проверка живости: TCP-коннект, без запроса в протоколе."""
        endpoint = self.config.endpoints[name]
        from urllib.parse import urlparse

        parsed = urlparse(endpoint.base_url)
        host, port = parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=endpoint.timeout_ms / 1000
            )
            writer.close()
            return True
        except (OSError, asyncio.TimeoutError):
            return False

    async def _dispatch(self, socket, message) -> None:
        try:
            envelope = json.loads(message)
        except ValueError:
            log.warning("получен неразбираемый конверт")
            return
        if envelope.get("type") != "connector.request":
            return

        # Лимит конкурентности — на стороне коннектора, а не backend: это он
        # знает, сколько выдержит оборудование за ним.
        async with self._sem:
            response = await asyncio.get_running_loop().run_in_executor(
                None, execute, envelope, self.config.endpoints
            )
        await socket.send(json.dumps(response))

    def stop(self) -> None:
        self._stopping = True
