"""
Сервисный слой доступа. Вьюхи вызывают эти функции и не знают ни про хэши
токенов, ни про уровни доверия.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.core.models import AuditLog
from apps.events.bus import SESSION_STARTED, emit
from apps.hotels.models import Room

from .models import GuestSession, ImpersonationGrant, TrustLevel, User
from .tokens import encode_refresh_token, encode_staff_token


class AuthenticationFailed(Exception):
    pass


@dataclass(slots=True)
class IssuedGuestSession:
    session: GuestSession
    token: str


def create_guest_session(
    *,
    room_number: str | None = None,
    language: str = "",
    user_agent: str = "",
    trust: str = TrustLevel.ROOM_SCANNED,
) -> IssuedGuestSession:
    """
    Гость отсканировал QR в номере → сессия.

    Уровень доверия по умолчанию — ROOM_SCANNED: физический доступ к QR в
    номере уже что-то значит. Подъём до PMS_VERIFIED — задача PMS-адаптера,
    его в этом прогоне нет.
    """
    hotel_id = require_hotel_id()

    room = None
    if room_number:
        room = Room.objects.filter(number=room_number, is_active=True).first()
        if room is None:
            raise AuthenticationFailed(f"Номер '{room_number}' не найден")
    else:
        # Без номера гость всё равно может смотреть витрину, но доверия меньше.
        trust = TrustLevel.ANONYMOUS

    raw_token, token_hash = GuestSession.issue_token()
    session = GuestSession.objects.create(
        hotel_id=hotel_id,
        room=room,
        token_hash=token_hash,
        trust=trust,
        language=language,
        user_agent=user_agent[:512],
        expires_at=GuestSession.default_expiry(),
    )
    AuditLog.record(
        "guest_session.created",
        actor_type=AuditLog.ActorType.GUEST,
        actor_id=session.pk,
        object_type="guest_session",
        object_id=session.pk,
        payload={"room": room_number or "", "trust": trust},
    )
    # Старт сессии — факт для аналитики трафика/конверсии (после коммита).
    emit(
        SESSION_STARTED,
        {"session_id": str(session.pk), "trust": session.trust, "language": session.language},
        hotel_id=hotel_id,
        actor_type="guest",
        actor_id=session.pk,
    )
    return IssuedGuestSession(session=session, token=raw_token)


def authenticate_staff_credentials(email: str, password: str) -> dict:
    """Логин сотрудника в рамках текущего отеля."""
    hotel_id = require_hotel_id()
    user = User.objects.filter(email=email.strip().lower(), is_active=True).first()
    if user is None or user.hotel_id != hotel_id:
        raise AuthenticationFailed("Неверный логин или пароль")
    if not check_password(password, user.password):
        raise AuthenticationFailed("Неверный логин или пароль")

    execution_point_ids = list(
        user.assignments.filter(is_active=True).values_list("execution_point_id", flat=True)
    )
    return {
        "access": encode_staff_token(user, execution_point_ids=execution_point_ids),
        "refresh": encode_refresh_token(user),
        "user_id": str(user.pk),
    }


@transaction.atomic
def start_impersonation(
    *,
    actor: User,
    target_user: User,
    reason: str,
    ttl_minutes: int = 30,
) -> dict:
    """
    Вход поддержки под сотрудником.

    Каркас: выдаём JWT с клеймом `imp` и пишем и грант, и запись аудита. Любое
    последующее действие останется отличимым от действия самого сотрудника.
    """
    if not reason.strip():
        raise ValueError("Impersonation без причины не выдаётся")
    if not actor.is_platform_admin:
        raise AuthenticationFailed("Impersonation доступен только платформенному админу")

    grant = ImpersonationGrant.objects.create(
        hotel_id=target_user.hotel_id,
        actor=actor,
        target_user=target_user,
        reason=reason.strip(),
        expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
    )
    AuditLog.record(
        "impersonation.started",
        actor_type=AuditLog.ActorType.PLATFORM,
        actor_id=actor.pk,
        impersonated_by=actor.pk,
        object_type="user",
        object_id=target_user.pk,
        payload={"reason": grant.reason, "grant_id": str(grant.pk)},
        hotel_id=target_user.hotel_id,
    )
    token = encode_staff_token(
        target_user, impersonated_by=actor.pk, ttl_minutes=ttl_minutes
    )
    return {"access": token, "grant_id": str(grant.pk), "expires_at": grant.expires_at}
