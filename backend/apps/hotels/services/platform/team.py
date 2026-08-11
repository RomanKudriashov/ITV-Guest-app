"""
Команда платформы и её журнал.

Участник команды — это User с `is_platform_admin` и без отеля. Отдельной модели
нет намеренно: иначе у нас появилось бы два вида «людей, которые входят», с
двумя разными механизмами пароля, блокировки и 2FA, — и однажды один из них
отстал бы от другого в вопросах безопасности.

Роль хранится в `platform_role` и означает право, а не должность:
владелец правит всё, поддержка ведёт отели и входит в них, «только чтение»
смотрит. Проверяют роль функции apps/accounts/platform_access.py — здесь только
хранение и выборка.
"""

from __future__ import annotations

import secrets

from django.contrib.auth.hashers import make_password

from apps.accounts.models import User
from apps.core.context import platform_scope
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import Hotel

VALID_ROLES = set(User.PlatformRole.values)


def list_members() -> list[dict]:
    with platform_scope():
        members = list(
            User.all_objects.using("platform")
            .filter(is_platform_admin=True, hotel__isnull=True)
            .order_by("email")
        )
    return [
        {
            "id": str(member.pk),
            "email": member.email,
            "full_name": member.full_name,
            "role": member.platform_role,
            "is_active": member.is_active,
            "totp_enabled": member.totp_enabled,
        }
        for member in members
    ]


def invite(*, email: str, role: str, full_name: str = "") -> tuple[User, str]:
    """
    Приглашение в команду. Пароль генерируется и отдаётся один раз: платформа
    заводит доступ, но не должна оставаться его хранителем.
    """
    email = (email or "").strip().lower()
    if "@" not in email:
        raise ValidationError("Нужен корректный email", field="email")
    if role not in VALID_ROLES:
        raise ValidationError(f"Неизвестная роль «{role}»", field="role")

    password = secrets.token_urlsafe(12)
    with platform_scope():
        existing = User.all_objects.using("platform").filter(email=email).first()
        if existing is not None:
            raise ValidationError("Такой пользователь уже есть", field="email")
        member = User.all_objects.using("platform").create(
            email=email,
            full_name=full_name.strip(),
            password=make_password(password),
            hotel=None,
            is_platform_admin=True,
            is_staff_member=False,
            platform_role=role,
        )
    return member, password


def update_member(user_id: str, *, role: str | None, is_active: bool | None, actor_id) -> User:
    with platform_scope():
        member = (
            User.all_objects.using("platform")
            .filter(pk=user_id, is_platform_admin=True, hotel__isnull=True)
            .first()
        )
        if member is None:
            raise NotFoundError("Участник не найден")

        fields: dict = {}
        if role is not None:
            if role not in VALID_ROLES:
                raise ValidationError(f"Неизвестная роль «{role}»", field="role")
            fields["platform_role"] = role
        if is_active is not None:
            # Владелец не может отключить или разжаловать сам себя: платформа,
            # оставшаяся без единого владельца, не чинится изнутри.
            if str(member.pk) == str(actor_id) and not is_active:
                raise ValidationError("Нельзя отключить самого себя", field="is_active")
            fields["is_active"] = is_active
        if role is not None and str(member.pk) == str(actor_id) and role != User.PlatformRole.OWNER:
            raise ValidationError("Нельзя снять с себя роль владельца", field="role")

        if fields:
            User.all_objects.using("platform").filter(pk=member.pk).update(**fields)
            for key, value in fields.items():
                setattr(member, key, value)
    return member


def audit_feed(*, limit: int = 100) -> list[dict]:
    """
    Полный журнал платформы: и действия без отеля (вход, команда, 2FA), и
    действия НАД отелями. Одним списком — потому что вопрос, который задают
    этому экрану, звучит «кто что делал», а не «в каком отеле».
    """
    limit = max(1, min(limit, 500))
    with platform_scope():
        rows = list(
            AuditLog.all_objects.using("platform")
            .filter(actor_type=AuditLog.ActorType.PLATFORM)
            .order_by("-created_at")[:limit]
        )
        hotel_ids = {row.hotel_id for row in rows if row.hotel_id}
        hotels = {
            hotel.pk: hotel
            for hotel in Hotel.objects.using("platform").filter(pk__in=hotel_ids)
        }
        actor_ids = {row.actor_id for row in rows if row.actor_id}
        actors = {
            user.pk: user.email
            for user in User.all_objects.using("platform").filter(pk__in=actor_ids)
        }

    return [
        {
            "id": str(row.pk),
            "at": row.created_at.isoformat(),
            "actor": actors.get(row.actor_id, "—"),
            "action": row.action,
            "hotel": hotels[row.hotel_id].name_i18n if row.hotel_id in hotels else None,
            "subdomain": hotels[row.hotel_id].subdomain if row.hotel_id in hotels else None,
            "payload": row.payload,
        }
        for row in rows
    ]
