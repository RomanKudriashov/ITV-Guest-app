"""
Сессии персонала: завести, продлить, оборвать.

Один слой на консоль платформы и на CMS отеля — как и обмен токенов. Разница
только в области (`scope`) и в том, каким подключением читается строка: у
платформенного администратора отеля нет, и его сессии живут под платформенной
ролью.

Почему отзыв решается ЗДЕСЬ, а не отпечатком пароля в токене. Отпечаток —
грубый выключатель: он рвёт всё разом, включая ту сессию, из которой пароль и
меняли, и не умеет «выйти на этом устройстве, остальные оставить». Строка на
сессию даёт и то, и другое.

ЧЕГО ЭТОТ МЕХАНИЗМ НЕ ДЕЛАЕТ. Отзыв срабатывает на обмене refresh, а не на
каждом запросе: выданный access доживает свой час. Проверять реестр на каждом
запросе персонала — это лишний поход в базу на каждый чих ради того, чтобы
сократить окно с часа до нуля. Для гранта поддержки такая проверка есть (там
цена ошибки другая и сессия короткая), для обычной работы — нет.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.core.context import platform_scope

from apps.accounts.models import StaffSession, User

PLATFORM = StaffSession.Scope.PLATFORM

# Сколько держим отработавшие строки после истечения. Нужны они только для
# ответа на вопрос «а что это был за вход» — неделя такой памяти достаточно.
KEEP_EXPIRED_DAYS = 7


def _rows(scope: str | None):
    """
    Набор строк нужным подключением.

    Платформенные сессии ссылаются на пользователя, чья строка в
    `accounts_user` НЕВИДИМА роли приложения (hotel = NULL + RLS). Проверка
    внешнего ключа выполняется от имени той же роли — и падает
    ForeignKeyViolation «ключа нет в accounts_user», хотя он есть. Поэтому
    платформенные сессии читаются и пишутся платформенным подключением, ровно
    как сам платформенный пользователь.
    """
    if scope == PLATFORM:
        return StaffSession.all_objects.using("platform")
    return StaffSession.all_objects


def _client(request) -> tuple[str, str | None]:
    """Чем и откуда вошли. Больше из запроса не берём."""
    if request is None:
        return "", None
    agent = (request.META.get("HTTP_USER_AGENT") or "")[:200]
    forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return agent, forwarded or request.META.get("REMOTE_ADDR") or None


def open_session(user: User, *, scope: str, request=None) -> StaffSession:
    """Новая сессия — на каждый вход по паролю."""
    agent, ip = _client(request)
    session = StaffSession(
        hotel_id=user.hotel_id,
        user=user,
        scope=scope,
        user_agent=agent,
        ip=ip,
        expires_at=timezone.now() + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
    )
    if scope == PLATFORM:
        with platform_scope():
            session.save(using="platform")
    else:
        session.save()
    # Уборка идёт по случаю входа: отдельного планировщика ради двух строк
    # заводить незачем, а вход — единственное место, где сессии прибавляются.
    purge_stale(user, scope=scope)
    return session


def touch(session: StaffSession) -> None:
    """
    Активность продлевает и строку тоже.

    Скользящее окно живёт в двух местах сразу — в сроке refresh и здесь; разойтись
    они не должны, иначе «неделя без активности» будет считаться по одному, а
    проверяться по другому.
    """
    now = timezone.now()
    _rows(session.scope).filter(pk=session.pk).update(
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        updated_at=now,
    )


def get_active(session_id, *, user_id=None, scope: str | None = None) -> StaffSession | None:
    """Живая сессия по идентификатору из токена."""
    if not session_id:
        return None
    try:
        uuid.UUID(str(session_id))
    except (TypeError, ValueError):
        return None
    queryset = _rows(scope).filter(pk=session_id)
    if user_id is not None:
        queryset = queryset.filter(user_id=user_id)
    session = queryset.first()
    return session if session is not None and session.is_active else None


def revoke(session_id, *, user_id, scope: str | None = None) -> bool:
    """Оборвать одну сессию — свою. Чужую по идентификатору не оборвать."""
    updated = _rows(scope).filter(
        pk=session_id, user_id=user_id, revoked_at__isnull=True
    ).update(revoked_at=timezone.now(), updated_at=timezone.now())
    return bool(updated)


def revoke_all(user_id, *, keep: uuid.UUID | str | None = None, scope: str | None = None) -> int:
    """
    Оборвать все сессии учётки.

    `keep` — та, из которой действуют. При смене пароля она остаётся: человек
    только что подтвердил, что это он, и выкидывать его с экрана, где он
    менял пароль, — наказание за правильное действие. Для «выйти везде» и для
    кражи `keep` не передают: там надо оборвать всё.
    """
    queryset = _rows(scope).filter(user_id=user_id, revoked_at__isnull=True)
    if keep:
        queryset = queryset.exclude(pk=keep)
    return queryset.update(revoked_at=timezone.now(), updated_at=timezone.now())


def purge_stale(user: User | None = None, *, scope: str | None = None) -> int:
    """
    Убрать отработавшее: истёкшие и оборванные строки старше KEEP_EXPIRED_DAYS.

    Растёт таблица только от входов, поэтому и чистим на входе — «прибавилось,
    заодно и подмели». Отдельная периодическая задача была бы ещё одним местом,
    которое надо не забыть настроить при развёртывании.
    """
    edge = timezone.now() - timedelta(days=KEEP_EXPIRED_DAYS)
    queryset = _rows(scope).filter(expires_at__lt=edge)
    if user is not None:
        # На входе подметаем только за этим пользователем: полный проход по
        # таблице на каждом логине — это счёт, который растёт вместе с отелем.
        queryset = queryset.filter(user_id=user.pk)
    # ЖЁСТКОЕ удаление: мягкое здесь бессмысленно — оно только пометило бы
    # строки и оставило их в таблице, то есть не убрало бы ровно то, ради чего
    # уборка и заводится.
    deleted, _ = queryset.hard_delete()
    return deleted


def serialize(session: StaffSession, *, current_id=None) -> dict:
    return {
        "id": str(session.pk),
        "created_at": session.created_at,
        "last_seen_at": session.last_seen_at,
        "expires_at": session.expires_at,
        "user_agent": session.user_agent,
        "ip": session.ip,
        "is_current": str(session.pk) == str(current_id) if current_id else False,
    }


def list_for(user_id, *, current_id=None, scope: str | None = None) -> list[dict]:
    """Живые сессии учётки — то, что показывается человеку."""
    now = timezone.now()
    rows = _rows(scope).filter(
        user_id=user_id, revoked_at__isnull=True, expires_at__gt=now
    ).order_by("-last_seen_at")
    return [serialize(row, current_id=current_id) for row in rows]
