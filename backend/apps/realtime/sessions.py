"""
ОТЗЫВ СЕССИИ ЗАКРЫВАЕТ ЕЁ СОКЕТЫ (п.64 бэклога).

С партии 30 отозванная сессия сотрудника теряет доступ сразу: следующий
HTTP-запрос — 401, новое подключение сокета — отказ. Но сокет, открытый ДО
отзыва (доска трекера, чат ресепшена), проверялся только на `connect` и
продолжал получать живые события, пока не оборвётся сам: закрытая сессия
видела новые заказы и сообщения гостей.

Теперь сокет сотрудника после авторизации вступает в группу СВОЕЙ сессии
(или гранта входа под аудитом), а каждый отзыв шлёт в эти группы «закрыться».
Отзывы сходятся в `sessions.forget` (выход, «выйти везде», отключение отеля,
кража refresh, уборка e2e) и `revoke_impersonation` — туда и подключено.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger(__name__)

SESSION_CLOSED = "session.closed"


def session_group(session_id) -> str:
    return f"staff-session.{session_id}"


def grant_group(grant_id) -> str:
    return f"support-grant.{grant_id}"


def group_for_claims(claims: dict | None) -> str | None:
    """Группа сокета по токену: грант — у входа под аудитом, сессия — у остальных."""
    claims = claims or {}
    if claims.get("imp"):
        return grant_group(claims["gid"]) if claims.get("gid") else None
    return session_group(claims["sid"]) if claims.get("sid") else None


def close_sockets(groups) -> None:
    """
    Закрыть сокеты групп — ПОСЛЕ фиксации отзыва: иначе сокет успел бы
    закрыться по отзыву, который потом откатился.
    """
    groups = [group for group in groups if group]
    if not groups:
        return

    def send() -> None:
        layer = get_channel_layer()
        if layer is None:
            return
        for group in groups:
            try:
                async_to_sync(layer.group_send)(group, {"type": SESSION_CLOSED})
            except Exception:  # шина недоступна — отзыв всё равно действует на HTTP
                logger.warning("Не удалось закрыть сокеты группы %s", group, exc_info=True)

    transaction.on_commit(send)
