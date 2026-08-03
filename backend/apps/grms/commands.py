"""
Доменные операции: отправить команду, прочитать состояние, подтвердить.

Здесь собирается «труба» целиком: адаптер даёт формат, транспорт — доставку,
AuditLog — журнал. Гостевого API тут нет и быть не должно (это G5) — только
слой, которым G5 будет пользоваться.

ГЛАВНОЕ РЕШЕНИЕ — цикл перечитывания, а не одно чтение после SET.

Между «iRidi принял команду» и «регистр обратной связи обновился» проходит
время: команда уходит в GRMS, тот доезжает до оборудования, и только следующий
цикл опроса Modbus приносит новое значение. Величина этой паузы не фиксирована.
Прочитать сразу — почти гарантированно прочитать СТАРОЕ значение и объявить
исправную команду неподтверждённой; гость увидел бы «не удалось выполнить» на
работающем выключателе.

Поэтому перечитываем несколько раз с растущей паузой в ограниченном окне и
прекращаем досрочно, как только feedback совпал.
"""

from __future__ import annotations

import logging
import time

from apps.core.models import AuditLog
from apps.grms import adapter, transport

logger = logging.getLogger(__name__)

# Паузы перед попытками перечитать. Сумма — окно подтверждения (~3.7 с).
# Числа подобраны под наблюдаемую задержку GRMS и подлежат калибровке на
# объекте; форма важнее чисел: несколько попыток с ростом паузы, а не одна.
CONFIRM_DELAYS_S = (0.2, 0.5, 1.0, 2.0)

RESULT_CONFIRMED = "confirmed"
RESULT_UNCONFIRMED = "unconfirmed"
RESULT_FAILED = "failed"
RESULT_ACCEPTED = "accepted"  # сцены: подтверждать нечем


def _journal(action: str, *, hotel, payload: dict, room: str = "") -> None:
    """
    Журнал команд — на AuditLog, без своей таблицы.

    Он уже тенантный, уже под RLS и уже проиндексирован под «последние по
    отелю». Диагностика инженера (G6) собирается выборкой по `grms.%`.

    Сырой ответ кладём СТРОКОЙ как есть: iRidi собирает его конкатенацией и
    умеет отдать невалидный JSON — в журнале должно лежать то, что реально
    пришло, а не то, что удалось разобрать.
    """
    from apps.core.context import tenant_context

    with tenant_context(hotel):
        AuditLog.record(
            action,
            actor_type=AuditLog.ActorType.SYSTEM,
            object_type="grms.channel",
            payload={"room": room, **payload},
            hotel_id=hotel.pk,
        )


def read(hotel, *, device: str, feedback: str, subdevice: str = "", room: str = "") -> adapter.IridiResult:
    """Однократное чтение feedback."""
    request_id = adapter.new_request_id()
    body = adapter.build_read(
        device=device, feedback=feedback, request_id=request_id, subdevice=subdevice
    )
    envelope = adapter.envelope(request_id=request_id, body=body)

    started = time.monotonic()
    raw = transport.send(hotel, envelope)
    duration_ms = int((time.monotonic() - started) * 1000)

    result = _interpret(raw, request_id=request_id, is_read=True)
    _journal(
        "grms.read",
        hotel=hotel,
        room=room,
        payload={
            "requestID": request_id,
            "device": device,
            "feedback": feedback,
            "value": result.value,
            "raw_response": raw.get("raw_body", ""),
            "transport_error": (raw.get("error") or {}).get("code"),
            "duration_ms": raw.get("duration_ms", duration_ms),
            "result": "ok" if result.ok else result.error,
        },
    )
    return result


def read_many(
    hotel, *, device: str, feedbacks: list[str], subdevice: str = "", room: str = ""
) -> dict[str, adapter.IridiResult]:
    """
    Прочитать пачку feedback'ов одного устройства. Возвращает {feedback: результат}.

    Гостевой экран открывается на 15+ каналов сразу (свет по зонам, шторы,
    фанкойл, DND). Последовательным чтением это 15 ходок до объекта и обратно
    подряд — гость смотрел бы на скелетон секундами. Поэтому ходки идут
    параллельно.

    Параллелизм ОГРАНИЧЕН: коннектор объявляет `max_concurrent_requests` (8), и
    превысить его значит получить отказы вместо ответов. Ограничитель стоит
    здесь, потому что здесь единственное место, где запросы порождаются пачкой.

    Журналируем ОДНОЙ записью на пачку, а не по записи на канал. Пятнадцать
    строк `grms.read` на каждое открытие экрана в каждом номере — это не
    диагностика, это способ утопить журнал: искать в нём команду гостя стало бы
    нечем. Что именно прочитано, в записи видно поимённо.
    """
    if not feedbacks:
        return {}

    started = time.monotonic()
    if not transport.node_is_online(hotel):
        # Узел офлайн — ходить некуда, и ждать TTL по каждому каналу тем более.
        results = {
            feedback: adapter.IridiResult(ok=False, error=adapter.CONNECTOR_OFFLINE)
            for feedback in feedbacks
        }
    else:
        results = _read_batch(hotel, device=device, feedbacks=feedbacks, subdevice=subdevice)

    _journal(
        "grms.read",
        hotel=hotel,
        room=room,
        payload={
            "device": device,
            "batch": len(feedbacks),
            "values": {
                feedback: (result.value if result.ok else None)
                for feedback, result in results.items()
            },
            "errors": {
                feedback: result.error
                for feedback, result in results.items()
                if not result.ok
            },
            "duration_ms": int((time.monotonic() - started) * 1000),
        },
    )
    return results


def _read_batch(hotel, *, device: str, feedbacks: list[str], subdevice: str) -> dict:
    import asyncio

    from asgiref.sync import async_to_sync

    # Ровно столько, сколько объявляет коннектор в своём конфиге.
    max_parallel = 8

    async def run() -> dict:
        semaphore = asyncio.Semaphore(max_parallel)

        async def one(feedback: str):
            request_id = adapter.new_request_id()
            body = adapter.build_read(
                device=device, feedback=feedback, request_id=request_id, subdevice=subdevice
            )
            envelope = adapter.envelope(request_id=request_id, body=body)
            async with semaphore:
                raw = await transport.asend(
                    str(hotel.pk), envelope, ttl_ms=int(envelope["ttl_ms"])
                )
            return feedback, _interpret(raw, request_id=request_id, is_read=True)

        pairs = await asyncio.gather(*(one(feedback) for feedback in feedbacks))
        return dict(pairs)

    return async_to_sync(run)()


def _interpret(raw: dict, *, request_id: str, is_read: bool) -> adapter.IridiResult:
    """Транспортный отказ до разбора протокола: разбирать нечего."""
    if not raw.get("ok"):
        code = (raw.get("error") or {}).get("code") or adapter.BAD_RESPONSE
        return adapter.IridiResult(ok=False, error=code, raw=raw.get("raw_body", ""))
    return adapter.parse_response(
        raw.get("raw_body", ""), request_id=request_id, is_read=is_read
    )


def send_command(
    hotel,
    *,
    device: str,
    channel: str,
    value,
    feedback: str = "",
    subdevice: str = "",
    room: str = "",
    confirm_delays=CONFIRM_DELAYS_S,
) -> dict:
    """
    Отправить команду и подтвердить её перечитыванием.

    Возвращает {result, value, error}, где result:
        confirmed   — feedback совпал с отправленным;
        unconfirmed — команда принята, но состояние не подтвердилось за окно;
        accepted    — подтверждать нечем (сцена: feedback'а нет);
        failed      — команда не ушла или отбита.

    Разница между `unconfirmed` и `failed` существенна: в первом случае команда
    в оборудование ушла и могла сработать, во втором — точно нет. Схлопывать их
    в «ошибку» нельзя, иначе гостю покажут «не получилось» там, где получилось.
    """
    request_id = adapter.new_request_id()
    body = adapter.build_set(
        device=device, channel=channel, value=value, request_id=request_id, subdevice=subdevice
    )
    envelope = adapter.envelope(request_id=request_id, body=body)

    started = time.monotonic()
    raw = transport.send(hotel, envelope)
    set_result = _interpret(raw, request_id=request_id, is_read=False)

    base_payload = {
        "requestID": request_id,
        "device": device,
        "command": channel,
        "feedback": feedback,
        "sent": value,
        "raw_response": raw.get("raw_body", ""),
        "transport_error": (raw.get("error") or {}).get("code"),
        "duration_ms": raw.get("duration_ms", int((time.monotonic() - started) * 1000)),
    }

    if set_result.failed:
        _journal(
            "grms.command", hotel=hotel, room=room,
            payload={**base_payload, "result": RESULT_FAILED, "error": set_result.error},
        )
        return {"result": RESULT_FAILED, "error": set_result.error, "value": None}

    # Сцена: feedback'а не существует, подтверждать нечего. Успешная отправка
    # и есть успех (ТЗ §12) — это не поблажка, а свойство протокола.
    if not feedback:
        _journal(
            "grms.command", hotel=hotel, room=room,
            payload={**base_payload, "result": RESULT_ACCEPTED},
        )
        return {"result": RESULT_ACCEPTED, "error": None, "value": None}

    confirmed, observed, attempts = _confirm(
        hotel, device=device, feedback=feedback, expected=value,
        subdevice=subdevice, room=room, delays=confirm_delays,
    )

    _journal(
        "grms.command", hotel=hotel, room=room,
        payload={
            **base_payload,
            "result": RESULT_CONFIRMED if confirmed else RESULT_UNCONFIRMED,
            "observed": observed,
            "confirm_attempts": attempts,
        },
    )
    if confirmed:
        return {"result": RESULT_CONFIRMED, "error": None, "value": observed}
    # Элемент возвращается к ФАКТИЧЕСКОМУ состоянию, а не к желаемому:
    # показать желаемое значило бы соврать гостю о номере.
    return {"result": RESULT_UNCONFIRMED, "error": None, "value": observed}


def _confirm(hotel, *, device, feedback, expected, subdevice, room, delays):
    """Перечитывание с растущей паузой. Досрочный выход при совпадении."""
    observed = None
    for attempt, delay in enumerate(delays, start=1):
        time.sleep(delay)
        result = read(hotel, device=device, feedback=feedback, subdevice=subdevice, room=room)
        if result.failed:
            # Канал пропал или связь отвалилась посреди подтверждения —
            # продолжать перечитывание бессмысленно.
            return False, observed, attempt
        observed = result.value
        if _matches(observed, expected):
            return True, observed, attempt
    return False, observed, len(delays)


def _matches(observed, expected) -> bool:
    """Сравниваем ЧИСЛА: feedback приходит строкой, команда уходит числом."""
    try:
        return int(observed) == int(expected)
    except (TypeError, ValueError):
        return str(observed) == str(expected)
