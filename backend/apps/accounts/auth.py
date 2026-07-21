"""
Классы аутентификации для django-ninja и для WebSocket.

Три скоупа — три класса. Общее правило: аутентификация НИКОГДА не выбирает
тенанта. Тенант уже выбран поддоменом (TenantMiddleware); токен обязан ему
соответствовать, иначе это попытка кросс-тенантного доступа.
"""

from __future__ import annotations

import logging

from django.http import HttpRequest
from django.utils import timezone
from ninja.security import HttpBearer

from apps.core.context import current_hotel_id, platform_scope

from .models import GuestSession, TrustLevel, User
from .tokens import TokenError, decode_staff_token

logger = logging.getLogger(__name__)


class AuthError(Exception):
    pass


# --- Гость -----------------------------------------------------------------


def authenticate_guest(token: str) -> GuestSession | None:
    """Непрозрачный токен → живая сессия текущего отеля."""
    if not token:
        return None
    session = (
        GuestSession.objects.select_related("room", "hotel")
        .filter(token_hash=GuestSession.hash_token(token))
        .first()
    )
    if session is None or not session.is_valid:
        return None
    # Менеджер уже отфильтровал по текущему отелю, но проверка явная: цена
    # ошибки здесь — чужие данные, а не пустая выдача.
    if session.hotel_id != current_hotel_id():
        logger.warning("Гостевой токен предъявлен не своему отелю")
        return None
    return session


class GuestAuth(HttpBearer):
    """Authorization: Bearer <guest token>."""

    min_trust: str = TrustLevel.ANONYMOUS

    def authenticate(self, request: HttpRequest, token: str):
        session = authenticate_guest(token)
        if session is None:
            return None
        if not session.has_trust(self.min_trust):
            return None

        # Продлевать last_seen на каждый чих дорого; обновляем не чаще минуты.
        now = timezone.now()
        if session.last_seen_at is None or (now - session.last_seen_at).total_seconds() > 60:
            GuestSession.objects.filter(pk=session.pk).update(last_seen_at=now)

        request.guest_session = session
        return session


class GuestAuthRoomVerified(GuestAuth):
    """Для действий, требующих подтверждения, что гость реально в номере."""

    min_trust = TrustLevel.ROOM_SCANNED


# --- Персонал --------------------------------------------------------------


def authenticate_staff(token: str) -> User | None:
    try:
        claims = decode_staff_token(token)
    except TokenError:
        return None

    hotel_id = current_hotel_id()
    if claims.get("scope") != "staff":
        return None
    if str(hotel_id) != str(claims.get("hotel")):
        logger.warning("JWT сотрудника предъявлен не своему отелю")
        return None

    user = User.objects.filter(pk=claims["sub"], is_active=True).first()
    if user is None or str(user.hotel_id) != str(hotel_id):
        return None

    user.impersonated_by = claims.get("imp")
    user.token_claims = claims
    return user


class StaffAuth(HttpBearer):
    def authenticate(self, request: HttpRequest, token: str):
        user = authenticate_staff(token)
        if user is None:
            return None
        request.user = user
        return user


# --- Платформа -------------------------------------------------------------


class PlatformAuth(HttpBearer):
    """
    Супер-админ платформы. У него hotel = NULL, поэтому строку пользователя не
    видно роли приложения из-за RLS — читаем через платформенное подключение.
    """

    def authenticate(self, request: HttpRequest, token: str):
        try:
            claims = decode_staff_token(token)
        except TokenError:
            return None
        if claims.get("scope") != "platform":
            return None

        with platform_scope():
            user = (
                User.all_objects.using("platform")
                .filter(pk=claims["sub"], is_active=True, is_platform_admin=True)
                .first()
            )
        if user is None:
            return None
        request.user = user
        return user
