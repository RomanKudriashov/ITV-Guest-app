"""Карточка отеля (партия 62-B): готовность и номерной фонд."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/hotels/{hotel_id}/readiness", summary="Готовность отеля: восемь правил")
@requires(READ)
def hotel_readiness(request: HttpRequest, hotel_id: str):
    from apps.hotels.services.platform.readiness import readiness

    return readiness(console.get_hotel(hotel_id))


@router.get("/hotels/{hotel_id}/rooms", summary="Номерной фонд отеля (только чтение)")
@requires(READ)
def hotel_rooms(
    request: HttpRequest,
    hotel_id: str,
    search: str = "",
    building: str = "",
    floor: str = "",
    category: str = "",
    variant: str = "",
    pin: str = "",
):
    from apps.hotels.services.platform.room_list import room_list

    return room_list(
        console.get_hotel(hotel_id),
        {"search": search, "building": building, "floor": floor, "category": category, "variant": variant, "pin": pin},
    )
