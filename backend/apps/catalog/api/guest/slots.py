"""Свободные окна брони для позиции типа slot."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.auth import GuestAuth
from apps.catalog.services.slots import available_slots_for_item

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.get("/slots", auth=guest_auth, summary="Свободные слоты позиции на дату")
def get_slots(request: HttpRequest, item_id: str, date: str):
    return available_slots_for_item(item_id, date)
