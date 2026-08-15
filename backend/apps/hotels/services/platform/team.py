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

from django.db.models import Q

from apps.accounts.models import User
from apps.core.context import platform_scope
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import Hotel

VALID_ROLES = set(User.PlatformRole.values)


def list_members(*, limit: int | None = None) -> dict:
    """
    Команда платформы. Растёт медленно, но предел здесь всё равно осознанный:
    выдача без предела — это обещание «столько и есть», которое однажды
    перестанет быть правдой молча.
    """
    from apps.hotels.services.platform.paging import clamp, envelope

    limit = clamp(limit)
    with platform_scope():
        queryset = User.all_objects.using("platform").filter(
            is_platform_admin=True, hotel__isnull=True
        )
        total = queryset.count()
        members = list(queryset.order_by("email")[:limit])
    rows = [
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
    return envelope(rows, total, limit)


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


def audit_feed(
    *,
    limit: int = 100,
    cursor: str | None = None,
    hotel_id: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> dict:
    """
    Журнал платформы: и действия без отеля (вход, команда, 2FA), и действия
    НАД отелями. Одним списком — вопрос к этому экрану звучит «кто что делал»,
    а не «в каком отеле».

    ЛИСТАНИЕ КУРСОРОМ, А НЕ СМЕЩЕНИЕМ. Журнал пополняется прямо во время
    просмотра: при `OFFSET` вторая страница показала бы часть первой, а часть
    записей не показала бы вовсе — и вчерашний инцидент оказался бы ровно в
    пропущенном. Курсор — это «строго раньше вот этой записи», и вставка новых
    сверху на него не влияет.

    Курсор составной (`время|id`): по одному времени записи не различить —
    массовая операция пишет десятки строк в одну миллисекунду, и листание
    зациклилось бы на них.

    ФИЛЬТРЫ. Без них глубина бессмысленна: пятьдесят тысяч записей нельзя
    пролистать до вчерашнего инцидента, его можно только найти.
    """
    from datetime import datetime

    from django.utils import timezone as dj_timezone
    from django.utils.dateparse import parse_datetime

    limit = max(1, min(limit, 500))

    def _moment(value: str | None) -> datetime | None:
        if not value:
            return None
        parsed = parse_datetime(value)
        if parsed is None:
            try:
                parsed = datetime.fromisoformat(value)
            except ValueError:
                return None
        return dj_timezone.make_aware(parsed) if dj_timezone.is_naive(parsed) else parsed

    with platform_scope():
        queryset = AuditLog.all_objects.using("platform").filter(
            actor_type=AuditLog.ActorType.PLATFORM
        )
        if action:
            queryset = queryset.filter(action=action)
        if hotel_id:
            queryset = queryset.filter(hotel_id=hotel_id)
        start_at, end_at = _moment(since), _moment(until)
        if start_at:
            queryset = queryset.filter(created_at__gte=start_at)
        if end_at:
            queryset = queryset.filter(created_at__lte=end_at)

        total = queryset.count()

        if cursor:
            at, _, cursor_id = cursor.partition("|")
            # `+00:00` в незакодированном URL приезжает как ` 00:00`: плюс в
            # строке запроса значит пробел. Без этого курсор молча
            # игнорировался бы, и листание возвращало бы одну и ту же страницу.
            moment = _moment(at.replace(" ", "+"))
            if moment and cursor_id:
                queryset = queryset.filter(
                    Q(created_at__lt=moment) | Q(created_at=moment, pk__lt=cursor_id)
                )

        # Берём на одну больше запрошенного: так видно, есть ли следующая
        # страница, без второго запроса «а сколько там дальше».
        rows = list(queryset.order_by("-created_at", "-pk")[: limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]

        hotel_ids = {row.hotel_id for row in rows if row.hotel_id}
        hotels = {
            item.pk: item
            for item in Hotel.objects.using("platform").filter(pk__in=hotel_ids)
        }
        actor_ids = {row.actor_id for row in rows if row.actor_id}
        actors = {
            user.pk: user.email
            for user in User.all_objects.using("platform").filter(pk__in=actor_ids)
        }

    items = [
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
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "next_cursor": (
            f"{rows[-1].created_at.isoformat()}|{rows[-1].pk}" if has_more and rows else None
        ),
    }


def audit_actions() -> list[str]:
    """
    Список действий для фильтра — берётся из самого журнала.

    Захардкоженный перечень разошёлся бы с жизнью в первый же новый вид
    события, и фильтр молча перестал бы находить его записи.
    """
    with platform_scope():
        return sorted(
            AuditLog.all_objects.using("platform")
            .filter(actor_type=AuditLog.ActorType.PLATFORM)
            .values_list("action", flat=True)
            .distinct()
        )
