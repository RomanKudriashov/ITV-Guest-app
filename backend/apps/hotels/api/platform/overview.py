"""Сводка по платформе и журнал её действий."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires

router = PlatformRouter(tags=["platform"])


@router.get("/overview", summary="Сводка по платформе")
@requires(READ)
def overview(request: HttpRequest):
    from apps.hotels.services.platform.overview import build_overview

    return build_overview()


# --- Аудит платформы -------------------------------------------------------


@router.get("/audit", summary="Журнал действий платформы")
@requires(READ)
def platform_audit(request: HttpRequest, limit: int = 100):
    from apps.hotels.services.platform.team import audit_feed

    return audit_feed(limit=limit)
