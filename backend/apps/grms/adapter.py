"""
Адаптер протокола iRidi: доменная команда ↔ формат iRidi.

Вся специфика протокола живёт ЗДЕСЬ и больше нигде. Коннектор — чистый
транспорт и про `request`/`device`/`channel` не знает; смена протокола iRidi
(например переход чтения на другой глагол) меняет этот файл, а коннектор на
объекте переустанавливать не нужно. Это прямое требование ТЗ §3.

Модуль НЕ ходит в сеть и НЕ трогает базу: на входе — доменные аргументы, на
выходе — тело запроса и разобранный ответ. Так его можно проверить целиком без
поднятого стенда, а сетевые отказы отлаживать отдельно от разбора протокола.

Все поправки — из прозвона боевого сервера (docs/grms/iridi-probe.md):

    §8.1  subdevice ПУСТОЙ. "Custom" из ТЗ и Postman ломает чтение: сервер
          склеивает тег как subdevice + ":" + feedback и ищет «Custom:F_DND».
    §4    HTTP-метод и путь игнорируются — читаем POST'ом. Требование ТЗ §7
          «клиент должен уметь GET с телом» этим снимается.
    §3    requestID возвращается эхом БЕЗ экранирования → строгий UUIDv4.
    §6.1  value "undefined" — недокументированный признак «канала нет».
    §2    всегда HTTP 200, status/value строками, две разные формы ответа.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field

# --- Коды ошибок (контракт G0, §4 backend-connector.md) ---------------------

CONNECTOR_OFFLINE = "CONNECTOR_OFFLINE"
ENDPOINT_UNKNOWN = "ENDPOINT_UNKNOWN"
ENDPOINT_UNREACHABLE = "ENDPOINT_UNREACHABLE"
TIMEOUT = "TIMEOUT"
REQUEST_REJECTED = "REQUEST_REJECTED"
BAD_RESPONSE = "BAD_RESPONSE"
DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND"
DEVICE_OR_CHANNEL_NOT_FOUND = "DEVICE_OR_CHANNEL_NOT_FOUND"
TTL_EXPIRED = "TTL_EXPIRED"

ENDPOINT_IRIDI = "iridi"

# UUIDv4 и ничего кроме. Не «похоже на uuid», а именно версия 4 с правильным
# вариантом: сервер вклеивает эту строку в ответ без экранирования, и любая
# вольность здесь — чужие поля в нашем JSON (см. §3 прозвона).
_UUID4 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


class ProtocolError(ValueError):
    """Нарушение протокола на НАШЕЙ стороне — до отправки в сеть."""


def new_request_id() -> str:
    return str(uuid.uuid4())


def validate_request_id(request_id: str) -> str:
    """
    Пропускает только строгий UUIDv4.

    Guard стоит здесь, а не «где-нибудь на входе», потому что это последняя
    точка перед сетью. Практическая проверка на боевом сервере: requestID
    вида `a" , "injected" : "yes` возвращается в ответе как есть и добавляет
    в JSON поле `injected`. Значит любая строка, дошедшая сюда из данных,
    управляет телом ответа — и корреляция по requestID перестаёт быть
    корреляцией.
    """
    if not isinstance(request_id, str) or not _UUID4.match(request_id):
        raise ProtocolError(f"requestID должен быть UUIDv4, получено: {request_id!r}")
    return request_id


# --- Сборка запроса ---------------------------------------------------------


def build_set(
    *, device: str, channel: str, value, request_id: str, subdevice: str = ""
) -> dict:
    """Тело SET. `value` уходит как есть — сервер принимает и число, и строку."""
    validate_request_id(request_id)
    if not device or not channel:
        raise ProtocolError("SET требует device и channel")
    return {
        "requestID": request_id,
        "request": "SET",
        "device": device,
        # Пустая строка — НЕ упущение. См. §8.1 прозвона: непустой subdevice
        # ломает адресацию тега на этом объекте.
        "subdevice": subdevice or "",
        "channel": channel,
        "value": value,
    }


def build_read(*, device: str, feedback: str, request_id: str, subdevice: str = "") -> dict:
    validate_request_id(request_id)
    if not device or not feedback:
        raise ProtocolError("GET требует device и feedback")
    return {
        "requestID": request_id,
        "request": "GET",
        "device": device,
        "subdevice": subdevice or "",
        "feedback": feedback,
    }


def envelope(
    *, request_id: str, body: dict, timeout_ms: int = 3000, ttl_ms: int = 5000
) -> dict:
    """
    Конверт для коннектора. Адрес НЕ передаётся — только идентификатор
    endpoint'а: коннектор резолвит его по своему локальному конфигу.

    Это не формальность. Позволив backend прислать URL, мы отдали бы облаку
    право ходить куда угодно во внутренней сети отеля — и allowlist на
    объекте перестал бы что-либо значить.
    """
    validate_request_id(request_id)
    if ttl_ms <= timeout_ms:
        raise ProtocolError("ttl_ms должен быть больше timeout_ms")
    return {
        "type": "connector.request",
        "requestID": request_id,
        "endpoint": ENDPOINT_IRIDI,
        # POST для ОБЕИХ операций: сервер смотрит только в тело (§4 прозвона).
        "method": "POST",
        "path": "/",
        "headers": {"Content-Type": "application/json"},
        "body": body,
        "timeout_ms": timeout_ms,
        "ttl_ms": ttl_ms,
    }


# --- Разбор ответа ----------------------------------------------------------


@dataclass
class IridiResult:
    ok: bool
    value: int | str | None = None
    error: str | None = None
    raw: str = ""

    @property
    def failed(self) -> bool:
        return not self.ok


def _coerce(value: str) -> int | str:
    """«1» → 1, «23» → 23, «23.5» оставляем строкой — не наше дело округлять."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def parse_response(raw_body: str, *, request_id: str, is_read: bool) -> IridiResult:
    """
    Нормализация ответа iRidi.

    Корреляция строго по requestID ИЗ ТЕЛА, а не по порядку ответов. Буфер
    ответа в скрипте iRidi — модульный синглтон; активной гонки прозвон не
    воспроизвёл (150 параллельных запросов чисто), но проверка стоит защитой
    в глубину: цена ошибки — состояние чужого канала, показанное как своё.
    """
    if raw_body is None:
        return IridiResult(ok=False, error=BAD_RESPONSE, raw="")

    try:
        payload = json.loads(raw_body)
    except (ValueError, TypeError):
        # Сюда попадает и «сломанный инъекцией» ответ. Сырое тело сохраняем:
        # в журнале должно лежать то, что реально пришло.
        return IridiResult(ok=False, error=BAD_RESPONSE, raw=raw_body)

    if not isinstance(payload, dict):
        return IridiResult(ok=False, error=BAD_RESPONSE, raw=raw_body)

    got_id = payload.get("requestID")
    # «Плохой запрос» отвечает requestID: null, отсутствующий — строкой
    # "undefined". Оба некоррелируемы и оба означают, что сервер нас не понял.
    if got_id != request_id:
        return IridiResult(ok=False, error=BAD_RESPONSE, raw=raw_body)

    status = payload.get("status")
    # Строкой в обычной форме, булевым — в форме «плохой запрос».
    ok = status is True or (isinstance(status, str) and status.lower() == "true")

    if not ok:
        # На ЧТЕНИИ status false означает именно «устройства нет»: отсутствие
        # тега сервер показывает через value "undefined". На ЗАПИСИ различить
        # нельзя — оба случая дают status false. Это ограничение протокола,
        # а не недоделка разбора (§6.1 прозвона).
        error = DEVICE_NOT_FOUND if is_read else DEVICE_OR_CHANNEL_NOT_FOUND
        return IridiResult(ok=False, error=error, raw=raw_body)

    if not is_read:
        # SET подтверждает лишь ПРИЁМ команды. Фактическое состояние
        # оборудования это не доказывает — подтверждение только перечитыванием.
        return IridiResult(ok=True, raw=raw_body)

    value = payload.get("value")
    if value is None:
        return IridiResult(ok=False, error=BAD_RESPONSE, raw=raw_body)
    if isinstance(value, str) and value == "undefined":
        # Недокументированный дискриминатор. Без этой ветки элемент показал бы
        # гостю строку «undefined» как состояние.
        return IridiResult(ok=False, error=CHANNEL_NOT_FOUND, raw=raw_body)

    return IridiResult(ok=True, value=_coerce(value), raw=raw_body)
