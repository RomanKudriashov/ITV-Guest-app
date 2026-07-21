"""
Токены доступа.

Персонал — JWT: stateless, короткоживущий, содержит hotel_id и точки
исполнения, чтобы трекер не ходил в базу на каждое сообщение WebSocket.
Гость — непрозрачный токен (см. GuestSession): отзываемый, без полезной
нагрузки внутри.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any

import jwt
from django.conf import settings


class TokenError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def encode_staff_token(
    user,
    *,
    execution_point_ids: list[uuid.UUID] | None = None,
    impersonated_by: uuid.UUID | None = None,
    ttl_minutes: int | None = None,
) -> str:
    """
    `imp` — клейм impersonation. Он попадает и в аудит: действие поддержки от
    имени сотрудника обязано оставаться отличимым от действия самого сотрудника.
    """
    issued = _now()
    payload: dict[str, Any] = {
        "sub": str(user.pk),
        "hotel": str(user.hotel_id) if user.hotel_id else None,
        "email": user.email,
        "scope": "platform" if user.is_platform_admin and not user.hotel_id else "staff",
        "hotel_admin": user.is_hotel_admin,
        "eps": [str(pk) for pk in (execution_point_ids or [])],
        "iat": int(issued.timestamp()),
        "exp": int(
            (
                issued
                + timedelta(minutes=ttl_minutes or settings.JWT_ACCESS_TTL_MINUTES)
            ).timestamp()
        ),
    }
    if impersonated_by:
        payload["imp"] = str(impersonated_by)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_staff_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Токен истёк") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Некорректный токен") from exc


def encode_refresh_token(user) -> str:
    issued = _now()
    payload = {
        "sub": str(user.pk),
        "typ": "refresh",
        "iat": int(issued.timestamp()),
        "exp": int(
            (issued + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)).timestamp()
        ),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
