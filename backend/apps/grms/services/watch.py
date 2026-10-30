"""
НАБЛЮДЕНИЕ ЗА ОТКРЫТЫМИ НОМЕРАМИ (партия 65).

Зачем. Свет выключили выключателем на стене, кондиционер — пультом. iRidi
узнаёт об этом от Bittel за 2 с, но сам никому не сообщает: у него есть только
запросы GET/SET, подписки на изменения нет. Экран гостя перечитывал номер раз в
минуту, а сокет будил его только после НАШИХ команд — щелчок на стене доезжал
до страницы за полминуты и дольше.

Как. Пока у номера открыт хотя бы один экран (сокет `RoomStateConsumer`
отмечает его здесь и продлевает отметку), отдельная служба `roomwatch` читает
номер раз в WATCH_INTERVAL_S и сравнивает с прошлым чтением. Изменилось —
будит сокеты номера тем же событием `state`, что и сцены: каждая сессия
собирает снимок сама, и чтение для него уже лежит в схлопывании (1,5 с) —
второй раз к оборудованию не ходим.

ОДНО ЧТЕНИЕ НА НОМЕР, а не на экран: десять гостей в одном номере — одно
чтение раз в две секунды. Номер без открытых экранов не читается вовсе.

НЕ МЕШАЕМ КОМАНДАМ. Пока по номеру идёт команда, его не трогаем: подтверждение
само читает и само будит экран, а лишнее чтение посреди него — лишняя очередь к
оборудованию.

Отдельная служба, а не задача Celery: у воркера два процесса, и подтверждение
команды занимает их до 16 с — опрос номеров там стоял бы в очереди за
командами и сам задерживал бы их.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from django.core.cache import cache

logger = logging.getLogger(__name__)

WATCH_INTERVAL_S = 2.0
# Отметка «экран открыт» живёт столько и продлевается сокетом раз в
# WATCH_RENEW_S: сокет оборвался без прощания — номер перестанут читать сам.
WATCH_TTL_S = 75
WATCH_RENEW_S = 30
INDEX_KEY = "grms:watch:index"
MAX_PARALLEL = 8


def _client():
    """Сырой клиент Redis кэша: индексу нужен ZSET, а у API кэша его нет."""
    return cache._cache.get_client(write=True)  # noqa: SLF001 — так и задумано у RedisCache


def _member(hotel_id, room_id) -> str:
    return f"{hotel_id}:{room_id}"


def mark_watched(hotel_id, room_id) -> None:
    """Экран номера открыт — читать его, пока отметка не истекла."""
    _client().zadd(INDEX_KEY, {_member(hotel_id, room_id): time.time() + WATCH_TTL_S})


def watched() -> list[tuple[str, str]]:
    """Открытые сейчас номера; истёкшие отметки тут же вычищаются."""
    client = _client()
    now = time.time()
    client.zremrangebyscore(INDEX_KEY, "-inf", now)
    members = client.zrangebyscore(INDEX_KEY, now, "+inf")
    out = []
    for member in members:
        text = member.decode() if isinstance(member, bytes) else str(member)
        hotel_id, _, room_id = text.partition(":")
        if hotel_id and room_id:
            out.append((hotel_id, room_id))
    return out


def _fingerprint(results: dict) -> str:
    """Отпечаток прочитанного: значения каналов; не ответивший канал — «?»."""
    values = {
        feedback: (str(result.value) if result is not None and result.ok else "?")
        for feedback, result in sorted(results.items())
    }
    return hashlib.blake2s(json.dumps(values, sort_keys=True).encode(), digest_size=12).hexdigest()


def _last_key(hotel_id, room_id) -> str:
    return f"grms:watch:last:{hotel_id}:{room_id}"


def check_room(hotel_id: str, room_id: str) -> bool:
    """
    Прочитать номер и разбудить его экраны, если состояние изменилось.
    Возвращает True, если разбудили.
    """
    from apps.grms.services import guest, inflight
    from apps.grms.tasks import broadcast_room
    from apps.hotels.models import Hotel

    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        return False
    context, _reason = guest.resolve_context_for_room(hotel, room_id)
    if context is None:
        return False
    control_ids = [control.get("controlId") for control in context.controls if control.get("controlId")]
    if inflight.active_controls(hotel.pk, room_id, control_ids):
        return False

    from apps.core.context import tenant_context

    with tenant_context(hotel):
        results, reason = guest._read_state(context)  # noqa: SLF001 — то же чтение, что у экрана
    if reason and not results:
        return False
    fingerprint = _fingerprint(results)
    key = _last_key(hotel_id, room_id)
    previous = cache.get(key)
    cache.set(key, fingerprint, WATCH_TTL_S * 2)
    if previous is None or previous == fingerprint:
        # Первое чтение — только запоминаем: экран и так получил снимок при
        # подключении, будить его нечем.
        return False
    broadcast_room(hotel_id, room_id, event="state")
    return True


def poll_once() -> int:
    """Один проход по открытым номерам. Возвращает число разбуженных."""
    rooms = watched()
    if not rooms:
        return 0

    def run(pair):
        from django.db import close_old_connections

        try:
            return check_room(*pair)
        except Exception:  # noqa: BLE001 — один номер не останавливает остальные
            logger.exception("Наблюдение: номер %s не прочитан", pair)
            return False
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(rooms))) as pool:
        return sum(1 for woke in pool.map(run, rooms) if woke)


def run_forever(interval: float = WATCH_INTERVAL_S) -> None:
    """Цикл службы: проход, пауза до следующего такта (не меньше 0,2 с)."""
    logger.info("Наблюдение за открытыми номерами: раз в %.1f с", interval)
    while True:
        started = time.monotonic()
        try:
            poll_once()
        except Exception:  # noqa: BLE001 — служба не падает от разового сбоя (Redis, БД)
            logger.exception("Наблюдение: проход не удался")
        time.sleep(max(0.2, interval - (time.monotonic() - started)))
