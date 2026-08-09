"""Публичный бренд отеля и локации доставки."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.catalog.schemas.guest import LocationsOut
from apps.core.context import current_language
from apps.hotels.services.brand_payload import serialize_hotel
from apps.hotels.services.locations import guest_locations

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.get("/hotel", auth=None, summary="Публичный бренд отеля по поддомену")
def public_hotel(request: HttpRequest):
    """
    Бренд отеля до входа: тенант известен из поддомена, поэтому тема/фон/логотип
    отдаются публично — экран входа темизируется до аутентификации.
    """
    hotel = getattr(request, "hotel", None)
    if hotel is None:
        from apps.core.errors import NotFoundError

        raise NotFoundError("Отель не найден")
    return serialize_hotel(hotel)


@router.get(
    "/locations", response=LocationsOut, auth=guest_auth, summary="Куда доставить"
)
def get_locations(request: HttpRequest):
    return guest_locations(request.guest_session, current_language())
