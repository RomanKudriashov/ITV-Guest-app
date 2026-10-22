"""Карточка отеля (партия 62-B): готовность и номерной фонд."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Schema
from pydantic import Field

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
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
    sort: str = "",
    dir: str = "",
):
    from apps.hotels.services.platform.room_list import room_list

    return room_list(
        console.get_hotel(hotel_id),
        {
            "search": search, "building": building, "floor": floor, "category": category,
            "variant": variant, "pin": pin, "sort": sort, "dir": dir,
        },
    )


class RoomRuleIn(Schema):
    # 0 — этаж: всё, что перед позицией; 1–3 — первые цифры номера.
    floor_digits: int = Field(ge=0, le=3)
    position_digits: int = Field(ge=1, le=3)


class RoomPlaceIn(Schema):
    # Пусто — вернуть номер правилу отеля.
    position: str = Field(default="", max_length=16)


@router.get("/hotels/{hotel_id}/rooms/map", summary="Схема номерного фонда: корпуса → этажи → номера")
@requires(READ)
def hotel_rooms_map(
    request: HttpRequest,
    hotel_id: str,
    search: str = "",
    building: str = "",
    floor: str = "",
    category: str = "",
    variant: str = "",
    pin: str = "",
    control: str = "",
    problem: str = "",
    sort: str = "",
    dir: str = "",
):
    from apps.hotels.services.platform.room_map import room_map

    return room_map(
        console.get_hotel(hotel_id),
        {
            "search": search, "building": building, "floor": floor, "category": category, "variant": variant,
            "pin": pin, "control": control, "problem": problem, "sort": sort, "dir": dir,
        },
    )


@router.put("/hotels/{hotel_id}/rooms/rule", summary="Как читать номер: этаж и позиция из номера")
@requires(WRITE)
def hotel_rooms_rule(request: HttpRequest, hotel_id: str, payload: RoomRuleIn):
    from apps.hotels.services import room_numbers

    hotel = console.get_hotel(hotel_id)
    before, after = room_numbers.set_rule(hotel, payload.floor_digits, payload.position_digits)
    if before != after:
        console.audit_hotel(
            hotel, "platform.hotel.rooms_rule_set", actor_id=request.user.pk,
            ip=request.META.get("REMOTE_ADDR"),
            payload={
                "changes": {
                    f"room_{key}": {"from": before[key], "to": after[key]}
                    for key in ("floor_digits", "position_digits")
                    if before[key] != after[key]
                }
            },
        )
    return {**after, "is_default": room_numbers.is_default(after)}


@router.put("/hotels/{hotel_id}/rooms/{room_id}/place", summary="Позиция номера на этаже, заданная руками")
@requires(WRITE)
def hotel_room_place(request: HttpRequest, hotel_id: str, room_id: str, payload: RoomPlaceIn):
    from apps.core.context import tenant_context
    from apps.core.errors import NotFoundError
    from apps.hotels.models import Room
    from apps.hotels.services import room_numbers

    hotel = console.get_hotel(hotel_id)
    value = payload.position.strip()
    with tenant_context(hotel):
        room = Room.objects.filter(pk=room_id).first() if _uuid(room_id) else None
        if room is None:
            raise NotFoundError("Номер не найден")
        before = room.position
        if before != value:
            room.position = value
            room.save(update_fields=["position", "updated_at"])
    if before != value:
        console.audit_hotel(
            hotel, "platform.hotel.room_place_set", actor_id=request.user.pk,
            ip=request.META.get("REMOTE_ADDR"),
            payload={"room": room.number, "changes": {"room_position": {"from": before, "to": value}}},
        )
    place = room_numbers.place_of(room, room_numbers.rule_of(hotel))
    return {"id": str(room.pk), "number": room.number, "position": place.position, "position_source": place.position_source}


def _uuid(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


@router.get("/hotels/{hotel_id}/history", summary="История отеля: правки из Control с фильтрами")
@requires(READ)
def hotel_history(
    request: HttpRequest,
    hotel_id: str,
    who: str = "",
    what: str = "",
    period: str = "",
    since: str = "",
    until: str = "",
    search: str = "",
    cursor: str = "",
    limit: int = 50,
    sort: str = "",
    dir: str = "",
):
    from apps.hotels.services.platform.journal import hotel_history as build

    return build(
        console.get_hotel(hotel_id),
        {
            "who": who, "what": what, "period": period, "since": since, "until": until,
            "search": search, "cursor": cursor, "limit": limit, "sort": sort, "dir": dir,
        },
    )
