"""Карточка позиции для гостя."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.catalog.schemas.guest import GuestItemDetailOut
from apps.catalog.services.menu import get_item_detail
from apps.core.context import current_language

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.get(
    "/item/{item_id}",
    response=GuestItemDetailOut,
    auth=guest_auth,
    summary="Карточка блюда",
)
def get_item(request: HttpRequest, item_id: str):
    return get_item_detail(item_id, language=current_language())
