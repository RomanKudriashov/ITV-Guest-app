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

import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.core.context import platform_scope

from apps.accounts.models import StaffSession, User

PLATFORM = StaffSession.Scope.PLATFORM

# ОКНО ТЕРПИМОСТИ ДЛЯ ДВУХ ВКЛАДОК (партия 30). Вкладки делят один refresh в
# localStorage; если обе обновились почти одновременно, вторая предъявляет
# refresh, который первая только что погасила. Это не кража, и выбивать
# человека за открытую вторую вкладку нельзя. В этом окне погашенный refresh
# ещё даёт новый access (без нового refresh — свежий уже лежит в хранилище,
# его положила первая вкладка). Вне окна повтор погашенного — кража: гаснет
# вся цепочка этого входа. Основная защита от гонки — на клиенте (одно
# обновление на вход через Web Locks), окно — подстраховка.
REFRESH_GRACE_SECONDS = 30

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


def fingerprint(jti: str, session_id) -> str:
    """
    Отпечаток refresh — по его идентификатору и сессии. Пустой `jti` у токенов,
    выданных до ротации: у них общий на сессию отпечаток, и первый их обмен
    переводит сессию на ротацию, никого не выбивая при выкатке.
    """
    return hashlib.sha256(f"{session_id}:{jti or 'legacy'}".encode()).hexdigest()


def issue_refresh(session: StaffSession, user: User) -> str:
    """
    Новый refresh для сессии: идентификатор случайный, в строку пишется только
    его отпечаток. Прежний действующий уходит в `previous_hash`.
    """
    from apps.accounts.services.tokens import encode_refresh_token

    jti = secrets.token_hex(16)
    now = timezone.now()
    changes = {
        "refresh_hash": fingerprint(jti, session.pk),
        "previous_hash": session.refresh_hash,
        "rotated_at": now if session.refresh_hash else None,
        "updated_at": now,
    }
    _rows(session.scope).filter(pk=session.pk).update(**changes)
    for field, value in changes.items():
        setattr(session, field, value)
    return encode_refresh_token(user, scope=session.scope, session_id=session.pk, jti=jti)


class RefreshReused(Exception):
    """Предъявлен погашенный refresh вне окна терпимости — цепочка оборвана."""


def rotate(session_id, presented_jti: str, *, user: User, scope: str) -> tuple[StaffSession, str | None]:
    """
    Обмен refresh. Возвращает сессию и НОВЫЙ refresh — либо None, если
    предъявлен только что погашенный refresh в окне терпимости (вторая
    вкладка): тогда клиент оставляет refresh, который уже положила первая.

    Под блокировкой строки: два одновременных обмена одного токена не
    выдадут две ветки цепочки.
    """
    from django.db import transaction

    db = "platform" if scope == PLATFORM else "default"
    with transaction.atomic(using=db):
        session = _rows(scope).select_for_update().filter(pk=session_id, user_id=user.pk).first()
        if session is None or not session.is_active:
            return None, None
        presented = fingerprint(presented_jti, session.pk)
        if not session.refresh_hash and not presented_jti:
            # Сессия и токен — до ротации: первый обмен переводит её на ротацию.
            # Отпечаток старого токена уходит в «предыдущий» — вторая вкладка с
            # тем же старым токеном в окне терпимости не будет принята за вора.
            session.refresh_hash = presented
            return session, issue_refresh(session, user)
        if presented == session.refresh_hash:
            return session, issue_refresh(session, user)
        grace = timedelta(seconds=REFRESH_GRACE_SECONDS)
        if (
            presented == session.previous_hash
            and session.rotated_at is not None
            and timezone.now() - session.rotated_at <= grace
        ):
            return session, None
        # Погашенный (или чужой для этой сессии) refresh — копию увели либо
        # хозяин опоздал на окно. В обоих случаях цепочка входа обрывается:
        # дальше по ней не пойдёт ни вор, ни хозяин — хозяин войдёт заново.
        now = timezone.now()
        _rows(scope).filter(pk=session.pk).update(
            revoked_at=now, revoked_reason="refresh_reused", updated_at=now
        )
    forget([session.pk])
    raise RefreshReused(str(session.pk))


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


# --- Живость сессии на каждом запросе (партия 30) ---------------------------
#
# ОТЗЫВ ДЕЙСТВУЕТ СРАЗУ, а не «когда истечёт access». Подписанный JWT живёт
# час, и до партии 30 закрытая сессия, сменённый пароль или выключенный отель
# пускали ещё до часа. Теперь каждый запрос персонала и консоли сверяет `sid`
# токена с реестром — так же, как вход под аудитом сверяет грант (17.08).
#
# Кэш — только «жива» и только на LIVE_CACHE_SECONDS: каждый отзыв ниже
# сбрасывает кэш своих сессий, поэтому кэш не продлевает жизнь отозванной,
# а лишь избавляет живую от запроса в базу на каждом обращении.
LIVE_CACHE_SECONDS = 30


def _live_key(session_id) -> str:
    return f"auth:session-live:{session_id}"


def forget(session_ids) -> None:
    """Сбросить кэш живости — после любого отзыва."""
    keys = [_live_key(pk) for pk in session_ids]
    if keys:
        cache.delete_many(keys)


def is_live(session_id, *, user_id, scope: str) -> bool:
    """Сессия токена жива: не отозвана, не истекла и принадлежит этой учётке."""
    if not session_id:
        return False
    key = _live_key(session_id)
    if cache.get(key) == str(user_id):
        return True
    if scope == PLATFORM:
        with platform_scope():
            session = get_active(session_id, user_id=user_id, scope=scope)
    else:
        session = get_active(session_id, user_id=user_id, scope=scope)
    if session is None:
        return False
    cache.set(key, str(user_id), LIVE_CACHE_SECONDS)
    return True


def revoke(session_id, *, user_id, scope: str | None = None, reason: str = "logout") -> bool:
    """Оборвать одну сессию — свою. Чужую по идентификатору не оборвать."""
    updated = _rows(scope).filter(
        pk=session_id, user_id=user_id, revoked_at__isnull=True
    ).update(revoked_at=timezone.now(), revoked_reason=reason, updated_at=timezone.now())
    forget([session_id])
    return bool(updated)


def revoke_all(
    user_id, *, keep: uuid.UUID | str | None = None, scope: str | None = None, reason: str = "logout_all"
) -> int:
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
    ids = list(queryset.values_list("pk", flat=True))
    count = queryset.update(revoked_at=timezone.now(), revoked_reason=reason, updated_at=timezone.now())
    forget(ids)
    return count


def revoke_hotel(hotel_id, *, reason: str) -> int:
    """
    Оборвать все входы сотрудников отеля — при его отключении и удалении
    (партия 30). Раньше отключённый отель лишь переставал находиться по
    поддомену: refresh сотрудников оставались живыми и ожили бы при обратном
    включении, а при удалении — висели бы в реестре до истечения.
    """
    with platform_scope():
        queryset = StaffSession.all_objects.using("platform").filter(
            hotel_id=hotel_id, revoked_at__isnull=True
        )
        ids = list(queryset.values_list("pk", flat=True))
        count = queryset.update(revoked_at=timezone.now(), revoked_reason=reason, updated_at=timezone.now())
    forget(ids)
    return count


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


PAGE_DEFAULT = 20
PAGE_MAX = 100


def list_for(
    user_id,
    *,
    current_id=None,
    scope: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> dict:
    """
    Живые сессии учётки — то, что показывается человеку. СТРАНИЦАМИ.

    Список отдавался целиком, и у администратора стенда с 7 936 живыми
    сессиями страница профиля вытягивалась до 620 000 px и не открывалась.
    Живой вход живёт неделю, и каждый вход без «выйти» — ещё строка: у
    человека с долгой историей их сотни.

    ТЕКУЩАЯ СЕССИЯ — ОТДЕЛЬНО И ВСЕГДА. Страница по «последней активности»
    могла бы её не содержать, а экран без «это вы» не с чем сверить. Поэтому
    `current` приходит отдельным полем, а в `items` её нет.
    """
    from apps.core.listing import clamp

    now = timezone.now()
    rows = _rows(scope).filter(
        user_id=user_id, revoked_at__isnull=True, expires_at__gt=now
    ).order_by("-last_seen_at", "-created_at")
    current = rows.filter(pk=current_id).first() if current_id else None
    others = rows.exclude(pk=current.pk) if current is not None else rows

    limit = clamp(limit, default=PAGE_DEFAULT, maximum=PAGE_MAX)
    offset = max(0, offset or 0)
    total = others.count()
    page = [serialize(row, current_id=current_id) for row in others[offset : offset + limit]]
    return {
        "current": serialize(current, current_id=current_id) if current is not None else None,
        "items": page,
        # Все живые сессии, кроме текущей: «показано 20 из 312».
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(page) < total,
    }
