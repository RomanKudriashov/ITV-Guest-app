"""
Всплывающие карточки сущностей для персонала (партия 59а): CMS и трекер.

Один адрес на тип — `/api/v1/cards/{type}/{key}` — и одна и та же карточка на
любом экране. Права и бюджет запросов — в сервисе (`services/cards.py`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.hotels.services import cards as svc

router = Router(tags=["cards"])


@router.get("/{card_type}/{key}", summary="Всплывающая карточка: заказ, номер, заведение")
def read_card(request: HttpRequest, card_type: str, key: str):
    return svc.card(request.user, card_type, key, current_language())
