"""
Сервисный слой доступа. Вьюхи вызывают эти функции и не знают ни про хэши
токенов, ни про уровни доверия.
"""

from __future__ import annotations

from dataclasses import dataclass
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.core.models import AuditLog
from apps.events.bus import SESSION_STARTED, emit
from apps.hotels.models import Room

from apps.accounts.models import GuestSession, ImpersonationGrant, TrustLevel, User
from apps.accounts.services.tokens import encode_refresh_token, encode_staff_token


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
    его пока нет.
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
        actor_email=actor.email,
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
    # Наружу уходит ОДНОРАЗОВЫЙ КОД, а не токен. Токен выдаётся в обмен на
    # него отдельным запросом уже со стороны отеля — так секрет не проходит
    # через адресную строку, историю браузера и логи прокси.
    code = secrets.token_urlsafe(24)
    ImpersonationGrant.objects.filter(pk=grant.pk).update(
        exchange_code_hash=hash_exchange_code(code),
        # Минута: код живёт ровно столько, сколько нужно, чтобы открылась
        # вкладка. Срок самой сессии здесь ни при чём.
        exchange_expires_at=timezone.now() + timedelta(minutes=1),
    )
    return {
        "code": code,
        "grant_id": str(grant.pk),
        "expires_at": grant.expires_at,
        "code_expires_at": timezone.now() + timedelta(minutes=1),
    }


def hash_exchange_code(code: str) -> str:
    """Хэш кода обмена. В базе лежит он, сам код показывается один раз."""
    import hashlib

    return hashlib.sha256(code.encode()).hexdigest()


def exchange_impersonation_code(code: str, *, hotel) -> dict:
    """
    Обменять одноразовый код на токен. Со стороны ОТЕЛЯ, по его поддомену.

    Код гасится в той же транзакции, что и выдача токена: повторное открытие
    той же ссылки не даёт второй сессии, даже если код успел куда-то попасть.
    """
    from django.db import transaction

    digest = hash_exchange_code((code or "").strip())
    if not code:
        raise AuthenticationFailed("Код обмена не передан")

    with transaction.atomic():
        grant = (
            ImpersonationGrant.all_objects.select_for_update()
            .filter(exchange_code_hash=digest, hotel_id=hotel.pk)
            .first()
        )
        if grant is None or not grant.code_is_valid:
            raise AuthenticationFailed("Код обмена недействителен")
        grant.exchanged_at = timezone.now()
        grant.save(update_fields=["exchanged_at", "updated_at"])
        target = grant.target_user

    ttl = max(1, int((grant.expires_at - timezone.now()).total_seconds() // 60))
    token = encode_staff_token(
        target, impersonated_by=grant.actor_id, grant_id=grant.pk, ttl_minutes=ttl
    )
    return {"access": token, "expires_at": grant.expires_at, "as_user": target.email}


def revoke_impersonation(grant_id, *, actor) -> ImpersonationGrant:
    """
    Оборвать сессию. Может тот, кто вошёл, и любой владелец платформы.

    Администратор отеля — НЕ может: он сессию видит (баннер в CMS), но не
    рвёт. Решение осознанное: иначе разбор инцидента можно заблокировать
    изнутри того самого отеля, который разбирают.
    """
    from apps.accounts.services.platform_access import is_owner

    # Платформенным подключением: грант лежит в тенантной таблице под RLS, а
    # отзывают его из платформенного запроса, где тенанта нет.
    from apps.core.context import platform_scope

    with platform_scope():
        grant = ImpersonationGrant.all_objects.using("platform").filter(pk=grant_id).first()
    if grant is None:
        raise AuthenticationFailed("Сессия не найдена")
    if not (grant.actor_id == actor.pk or is_owner(actor)):
        raise AuthenticationFailed("Оборвать сессию может вошедший или владелец платформы")
    if grant.revoked_at is None:
        with platform_scope():
            ImpersonationGrant.all_objects.using("platform").filter(pk=grant.pk).update(
                revoked_at=timezone.now(), revoked_by=actor, updated_at=timezone.now()
            )
        grant.revoked_at = timezone.now()
        grant.revoked_by = actor
        # Журнал отеля пишется В ЕГО КОНТЕКСТЕ: платформенный запрос идёт без
        # тенанта, и RLS справедливо отвергает строку с чужим hotel_id.
        from apps.core.context import tenant_context

        if grant.hotel_id:
            with tenant_context(grant.hotel_id):
                AuditLog.record(
                    "impersonation.revoked",
                    actor_type=AuditLog.ActorType.PLATFORM,
                    actor_id=actor.pk,
                    object_type="user",
                    object_id=grant.target_user_id,
                    payload={"grant_id": str(grant.pk), "by_owner": grant.actor_id != actor.pk},
                    hotel_id=grant.hotel_id,
                )
    return grant
