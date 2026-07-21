"""
Идемпотентность небезопасных операций.

Контракт:
  * первый вызов с ключом K выполняет операцию и сохраняет ответ;
  * повтор с тем же K и тем же телом возвращает сохранённый ответ, ничего не
    выполняя повторно;
  * тот же K с другим телом — конфликт (409): клиент переиспользовал ключ.

Гонка двух одновременных запросов разрешается уникальным индексом в БД, а не
блокировкой в питоне: проигравший ловит IntegrityError и читает чужой ответ.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable

from django.db import IntegrityError, transaction

from .models import IdempotencyKey


class IdempotencyConflict(Exception):
    """Ключ уже использован с другим телом запроса."""


def fingerprint(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(slots=True)
class IdempotentResult:
    value: Any
    replayed: bool


def run_idempotent(
    *,
    scope: str,
    key: str | None,
    request_payload: Any,
    operation: Callable[[], tuple[Any, Any]],
) -> IdempotentResult:
    """
    operation() должна вернуть кортеж (сериализуемый_ответ, object_id).

    Без ключа операция выполняется как обычно — идемпотентность опциональна,
    но для создания заказа API её требует.
    """
    if not key:
        response, _ = operation()
        return IdempotentResult(value=response, replayed=False)

    digest = fingerprint(request_payload)
    existing = IdempotencyKey.objects.filter(scope=scope, key=key).first()
    if existing is not None:
        if existing.request_fingerprint != digest:
            raise IdempotencyConflict(
                f"Ключ идемпотентности '{key}' уже использован с другим телом запроса."
            )
        return IdempotentResult(value=existing.response, replayed=True)

    try:
        with transaction.atomic():
            response, object_id = operation()
            IdempotencyKey.objects.create(
                scope=scope,
                key=key,
                request_fingerprint=digest,
                response=response,
                object_id=object_id,
            )
    except IntegrityError:
        # Параллельный запрос успел раньше — отдаём его результат.
        winner = IdempotencyKey.objects.filter(scope=scope, key=key).first()
        if winner is None:
            raise
        if winner.request_fingerprint != digest:
            raise IdempotencyConflict(
                f"Ключ идемпотентности '{key}' уже использован с другим телом запроса."
            ) from None
        return IdempotentResult(value=winner.response, replayed=True)

    return IdempotentResult(value=response, replayed=False)
