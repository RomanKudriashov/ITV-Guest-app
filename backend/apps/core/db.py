"""
Мост между питон-контекстом тенанта и сессией Postgres.

RLS-политики (см. apps/core/migrations/0002_rls.py) сравнивают hotel_id строки
с сессионной переменной `app.current_hotel`. Если переменная не выставлена,
current_setting(..., true) вернёт NULL, сравнение даст NULL — и строка не
пройдёт. Это осознанный fail-closed: без контекста отеля не видно ничего.
"""

from __future__ import annotations

import logging
import uuid

from django.db import connections

logger = logging.getLogger(__name__)

SESSION_VAR = "app.current_hotel"


def set_db_tenant(hotel_id: uuid.UUID | str | None, *, using: str = "default") -> None:
    """
    Выставляет `app.current_hotel` в текущей сессии БД.

    Значение сессионное (is_local=false), а не транзакционное: Django по
    умолчанию в autocommit, и SET LOCAL сбросился бы сразу после запроса.
    Middleware выставляет переменную в начале запроса и чистит в конце.
    """
    connection = connections[using]
    if connection.connection is None and hotel_id is None:
        # Соединения ещё нет и чистить нечего — не будим базу зря.
        return
    value = "" if hotel_id is None else str(hotel_id)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config(%s, %s, false)", [SESSION_VAR, value])
    except Exception:  # noqa: BLE001 — база может быть недоступна на старте
        logger.warning("Не удалось выставить %s=%r", SESSION_VAR, value, exc_info=True)


def get_db_tenant(*, using: str = "default") -> str | None:
    connection = connections[using]
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting(%s, true)", [SESSION_VAR])
        row = cursor.fetchone()
    value = row[0] if row else None
    return value or None
