"""
Контекст выполнения: какой отель, какой язык, кто актор.

Это единственный источник правды о текущем тенанте. От него зависят:
  * TenantManager      — автоматический скоуп ORM-запросов;
  * set_db_tenant      — сессионная переменная Postgres для RLS;
  * TranslatableField  — выбор языка при чтении переводимых полей.

Разработчик прикладного кода НЕ пишет фильтр по hotel_id руками — он либо
работает внутри HTTP-запроса (контекст выставил middleware), либо явно
оборачивает код в tenant_context(hotel).
"""

from __future__ import annotations

import contextlib
import uuid
from contextvars import ContextVar
from typing import Any, Iterator

_hotel_id: ContextVar[uuid.UUID | None] = ContextVar("hotel_id", default=None)
_language: ContextVar[str | None] = ContextVar("language", default=None)
_actor: ContextVar[Any] = ContextVar("actor", default=None)
# Явное разрешение работать поверх всех отелей (платформенный уровень).
_platform_scope: ContextVar[bool] = ContextVar("platform_scope", default=False)


class MissingTenantError(RuntimeError):
    """Тенант-операция вне контекста отеля. Это всегда баг, не пользовательская ошибка."""


# --- Чтение ----------------------------------------------------------------


def current_hotel_id() -> uuid.UUID | None:
    return _hotel_id.get()


def require_hotel_id() -> uuid.UUID:
    hotel_id = _hotel_id.get()
    if hotel_id is None:
        raise MissingTenantError(
            "Операция требует контекста отеля. Оберни вызов в tenant_context(hotel)."
        )
    return hotel_id


def current_language() -> str | None:
    return _language.get()


def current_actor() -> Any:
    return _actor.get()


def is_platform_scope() -> bool:
    return _platform_scope.get()


# --- Установка -------------------------------------------------------------


def _coerce_hotel_id(hotel: Any) -> uuid.UUID | None:
    if hotel is None:
        return None
    if isinstance(hotel, uuid.UUID):
        return hotel
    if isinstance(hotel, str):
        return uuid.UUID(hotel)
    # Инстанс Hotel — не импортируем модель, чтобы не ловить циклы.
    return hotel.pk


@contextlib.contextmanager
def tenant_context(hotel: Any, *, language: str | None = None) -> Iterator[None]:
    """
    Выставляет тенанта и в питон-контексте, и в сессии Postgres.

    Сессионная переменная нужна ровно для того, чтобы RLS-политики отработали,
    даже если кто-то полез в базу мимо TenantManager (raw SQL, .all_objects).
    """
    from .db import set_db_tenant

    hotel_id = _coerce_hotel_id(hotel)
    token_hotel = _hotel_id.set(hotel_id)
    token_lang = _language.set(language) if language is not None else None
    set_db_tenant(hotel_id)
    try:
        yield
    finally:
        _hotel_id.reset(token_hotel)
        if token_lang is not None:
            _language.reset(token_lang)
        # Возвращаем сессионную переменную к внешнему контексту (если он был),
        # иначе вложенные tenant_context «протекали» бы наружу.
        set_db_tenant(_hotel_id.get())


@contextlib.contextmanager
def platform_scope() -> Iterator[None]:
    """
    Осознанный выход за пределы одного отеля.

    Нужен платформенному уровню (супер-админ, кросс-отельная аналитика,
    onboarding нового отеля). На уровне ORM снимает фильтр по hotel_id; на
    уровне Postgres по-прежнему действует RLS, поэтому запросы, читающие
    тенант-таблицы, должны идти через connection платформенной роли —
    .using("platform").
    """
    token = _platform_scope.set(True)
    try:
        yield
    finally:
        _platform_scope.reset(token)


@contextlib.contextmanager
def language_context(language: str | None) -> Iterator[None]:
    token = _language.set(language)
    try:
        yield
    finally:
        _language.reset(token)


@contextlib.contextmanager
def actor_context(actor: Any) -> Iterator[None]:
    token = _actor.set(actor)
    try:
        yield
    finally:
        _actor.reset(token)


def set_request_context(
    *, hotel: Any = None, language: str | None = None, actor: Any = None
) -> None:
    """
    Императивная установка контекста — для middleware, где нет удобного `with`.
    Сбрасывается автоматически: у каждого запроса свой контекст выполнения.
    """
    from .db import set_db_tenant

    hotel_id = _coerce_hotel_id(hotel)
    _hotel_id.set(hotel_id)
    _language.set(language)
    _actor.set(actor)
    set_db_tenant(hotel_id)


def clear_request_context() -> None:
    from .db import set_db_tenant

    _hotel_id.set(None)
    _language.set(None)
    _actor.set(None)
    _platform_scope.set(False)
    set_db_tenant(None)
