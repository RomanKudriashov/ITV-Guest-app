"""
Стартовый снимок CMS: всё, что редактору нужно на первом экране.

Собирается одним запросом сознательно: пять отдельных вызовов на старте
CMS — это пять шансов показать оператору полупустой интерфейс.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings

from apps.catalog.vocabularies import ALLERGENS, DAY_PARTS, FLAGS
from apps.hotels.models import ExecutionPoint, HotelLanguage
from apps.hotels.services import schedules as schedule_svc
from apps.hotels.services.hotel import current_hotel


def bootstrap_payload() -> dict[str, Any]:
    hotel = current_hotel()
    languages = list(
        HotelLanguage.objects.filter(is_active=True)
        .order_by("sort_order", "code")
        .values("code", "title", "is_default")
    )
    if not languages:
        languages = [
            {"code": code, "title": code.upper(), "is_default": code == hotel.default_language}
            for code in settings.SUPPORTED_LANGUAGES
        ]

    return {
        "hotel": {
            "id": str(hotel.pk),
            "name": hotel.name_i18n,
            "subdomain": hotel.subdomain,
            "currency": hotel.currency,
            "currency_minor_units": hotel.currency_minor_units,
            "timezone": hotel.timezone,
            "default_language": hotel.default_language,
        },
        "languages": languages,
        # ЧУЖОЕ ПРИСУТСТВИЕ. Отель обязан видеть, что внутри него сейчас
        # работает поддержка: механизм входа под аудитом строился ради
        # разделимости действий, а сторона, которую защищают, о вторжении не
        # знала вовсе. Отдаётся ВСЕМ пользователям CMS отеля, а не только
        # самому вошедшему.
        "support_session": _active_support_session(),
        "flags": FLAGS,
        "allergens": ALLERGENS,
        "schedules": schedule_svc.list_schedules(),
        "execution_points": [
            {"id": str(point.pk), "code": point.code, "title": point.title or {}}
            for point in ExecutionPoint.objects.filter(is_active=True).order_by("code")
        ],
        "day_parts": DAY_PARTS,
    }


def _active_support_session() -> dict[str, Any] | None:
    """
    Живая сессия поддержки в этом отеле: кто, когда вошёл, до какого времени.

    None — никого нет. Пустой словарь здесь был бы хуже: «нет данных» и «есть
    сессия без подробностей» на экране выглядят одинаково.
    """
    from django.utils import timezone as dj_timezone

    from apps.accounts.models import ImpersonationGrant

    # Никакого select_related на `actor`: он живёт в платформенной части, его
    # строка отелю под RLS не видна, и INNER JOIN отбрасывал сам грант — отель
    # не видел чужого присутствия именно потому, что не видел вошедшего.
    # Почта лежит копией на самом гранте, поэтому хватает своего подключения.
    grant = (
        ImpersonationGrant.objects.filter(
            revoked_at__isnull=True,
            expires_at__gt=dj_timezone.now(),
            exchanged_at__isnull=False,
        )
        .order_by("-created_at")
        .first()
    )
    if grant is None:
        return None
    return {
        "actor": grant.actor_email,
        "reason": grant.reason,
        "started_at": grant.created_at.isoformat(),
        "expires_at": grant.expires_at.isoformat(),
    }
