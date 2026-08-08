"""Тарифная сетка: что открывает и какие лимиты."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.hotels.services.platform import console

router = Router(tags=["platform"])


@router.get("/tariffs", summary="Сетка тарифов: что открывает и какие лимиты")
def list_tariffs(request: HttpRequest):
    return console.tariff_grid()
