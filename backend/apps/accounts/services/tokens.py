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
    grant_id: uuid.UUID | None = None,
    ttl_minutes: int | None = None,
    mfa: bool = False,
    session_id: uuid.UUID | str | None = None,
) -> str:
    """
    `imp` — клейм impersonation. Он попадает и в аудит: действие поддержки от
    имени сотрудника обязано оставаться отличимым от действия самого сотрудника.

    `mfa` — подтверждён ли вход вторым фактором. Признак живёт в ТОКЕНЕ, а не в
    сессии на сервере: иначе включение 2FA не обесценивало бы токены, выданные
    до неё, и рубеж поднимался бы только для новых входов.
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
    # Идентификатор гранта. Без него отзыв не имел бы силы: подписанный JWT
    # проверить не у кого, и «оборвали сессию» означало бы только «больше не
    # выдадим новый токен», а выданный работал бы до конца срока.
    if grant_id:
        payload["gid"] = str(grant_id)
    if mfa:
        payload["mfa"] = True
    # Какой сессии принадлежит токен. Нужен, чтобы «выйти» знало, что рвать, а
    # смена пароля — что оставить. У входа под аудитом сессии нет: он живёт
    # своим грантом (`gid`) и рефрешу не подлежит.
    if session_id:
        payload["sid"] = str(session_id)
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


def encode_refresh_token(
    user, *, scope: str | None = None, session_id: uuid.UUID | str | None = None
) -> str:
    """
    Долгоживущий токен ОБНОВЛЕНИЯ. Обменивается на access и на себя же —
    скользящее окно: активность продлевает, неделя молчания заканчивает.

    `scope` вшит намеренно: refresh сотрудника не должен обмениваться на
    платформенный access, и наоборот. Раньше поля не было — и не было
    эндпоинта обмена, так что вопрос не вставал.

    `sid` — строка реестра сессий: по ней обмен проверяет, что сессию не
    оборвали выходом.
    """
    issued = _now()
    payload = {
        "sub": str(user.pk),
        "typ": "refresh",
        "scope": scope
        or ("platform" if user.is_platform_admin and not user.hotel_id else "staff"),
        # Отель — чтобы refresh нельзя было предъявить чужому тенанту.
        "hotel": str(user.hotel_id) if user.hotel_id else None,
        # Ссылка на строку реестра. Отзыв решается ЕЮ, а не отпечатком пароля:
        # отпечаток рвал все сессии разом, включая ту, из которой пароль
        # меняли, и «выйти на этом устройстве» им было не выразить.
        "sid": str(session_id) if session_id else None,
        "iat": int(issued.timestamp()),
        "exp": int(
            (issued + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)).timestamp()
        ),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_refresh_token(token: str) -> dict[str, Any]:
    """
    Разбор refresh. Отдельно от access: подпись общая, а смысл разный, и
    принять access там, где ждут refresh, значило бы дать часовому токену
    недельную силу.
    """
    claims = decode_staff_token(token)
    if claims.get("typ") != "refresh":
        raise TokenError("Это не токен обновления")
    return claims
