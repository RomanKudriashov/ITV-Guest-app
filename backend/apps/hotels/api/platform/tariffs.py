"""Тарифная сетка: что открывает и какие лимиты."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires

from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/tariffs", summary="Сетка тарифов: что открывает и какие лимиты")
@requires(READ)
def list_tariffs(request: HttpRequest):
    return console.tariff_grid()
