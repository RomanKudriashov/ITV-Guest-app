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
        "flags": FLAGS,
        "allergens": ALLERGENS,
        "schedules": schedule_svc.list_schedules(),
        "execution_points": [
            {"id": str(point.pk), "code": point.code, "title": point.title or {}}
            for point in ExecutionPoint.objects.filter(is_active=True).order_by("code")
        ],
        "day_parts": DAY_PARTS,
    }
