"""
Номерной фонд в Control — правка (партия 63-1).

Ручки поверх тех же сервисов, что у панели отеля (`services/platform/room_edit.py`).
Права как во всём Control: чтение — `READ`, любая правка — `WRITE` (у
«только чтение» — 403 и нет кнопок на экране).
"""

from __future__ import annotations

from datetime import date

from django.http import HttpRequest
from ninja import Schema
from pydantic import Field

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.services.platform import console
from apps.hotels.services.platform import room_edit as edit

router = PlatformRouter(tags=["platform"])


class RoomPatchIn(Schema):
    number: str | None = Field(default=None, max_length=32)
    confirm_rename: bool | None = None
    keep_device_name: bool | None = None
    floor: str | None = Field(default=None, max_length=16)
    position: str | None = Field(default=None, max_length=16)
    building_id: str | None = None
    category_id: str | None = None
    is_active: bool | None = None
    out_of_service: bool | None = None
    # Код варианта; пустая строка — снять вариант.
    variant: str | None = None
    # Имя устройства руками; пустая строка — по шаблону варианта.
    device_name: str | None = Field(default=None, max_length=255)


class RoomsBulkIn(Schema):
    spec: str = Field(default="", max_length=4000)
    floor: str = Field(default="", max_length=16)
    building_id: str | None = None
    category_id: str | None = None
    # Удалённые с тем же номером: вернуть с историей (по умолчанию) или завести заново.
    restore: bool = True


class RoomPinIn(Schema):
    pin: str = Field(default="", max_length=12)
    generate: bool = False
    valid_until: date | None = None


class RoomsDictionaryIn(Schema):
    # Название на каждом языке отеля: {"ru": "Главный", "en": "Main"}.
    title: dict[str, str]


def _bulk_data(payload: RoomsBulkIn) -> dict:
    data = payload.dict()
    # Поля, которых нет в запросе, сервис панели не трогает: передаём только заданные.
    return {k: v for k, v in data.items() if v not in (None,)}


@router.get("/hotels/{hotel_id}/rooms/dictionaries", summary="Корпуса, категории, варианты и языки — для правки фонда")
@requires(READ)
def rooms_dictionaries(request: HttpRequest, hotel_id: str):
    return edit.dictionaries(console.get_hotel(hotel_id), request.user)


@router.post("/hotels/{hotel_id}/rooms/bulk/preview", summary="Что появится: предпросмотр заведения номеров")
# Сам предпросмотр ничего не пишет, но это шаг заведения: POST — правом правки.
@requires(WRITE)
def rooms_bulk_preview(request: HttpRequest, hotel_id: str, payload: RoomsBulkIn):
    return edit.bulk_preview(console.get_hotel(hotel_id), request.user, _bulk_data(payload))


@router.post("/hotels/{hotel_id}/rooms/bulk", summary="Добавить номера: один, список или диапазон")
@requires(WRITE)
def rooms_bulk(request: HttpRequest, hotel_id: str, payload: RoomsBulkIn):
    return edit.bulk_create(console.get_hotel(hotel_id), request.user, _bulk_data(payload))


@router.get("/hotels/{hotel_id}/rooms/{room_id}/detail", summary="Номер целиком — для окна правки")
@requires(READ)
def room_detail(request: HttpRequest, hotel_id: str, room_id: str):
    return edit.room_detail(console.get_hotel(hotel_id), request.user, room_id)


@router.patch("/hotels/{hotel_id}/rooms/{room_id}", summary="Изменить номер")
@requires(WRITE)
def room_patch(request: HttpRequest, hotel_id: str, room_id: str, payload: RoomPatchIn):
    return edit.update_room(console.get_hotel(hotel_id), request.user, room_id, payload.dict(exclude_unset=True))


@router.get("/hotels/{hotel_id}/rooms/{room_id}/rename-check", summary="Что изменится при переименовании номера")
@requires(READ)
def room_rename_check(request: HttpRequest, hotel_id: str, room_id: str, number: str):
    return edit.rename_impact(console.get_hotel(hotel_id), request.user, room_id, number)


@router.get("/hotels/{hotel_id}/rooms/{room_id}/delete-check", summary="Что случится при удалении номера")
@requires(READ)
def room_delete_check(request: HttpRequest, hotel_id: str, room_id: str):
    return edit.delete_impact(console.get_hotel(hotel_id), request.user, room_id)


@router.delete("/hotels/{hotel_id}/rooms/{room_id}", summary="Удалить номер (мягко): снять PIN, закрыть сессии гостей")
@requires(WRITE)
def room_delete(request: HttpRequest, hotel_id: str, room_id: str):
    return edit.delete_room(console.get_hotel(hotel_id), request.user, room_id)


@router.post("/hotels/{hotel_id}/rooms/{room_id}/pin", summary="Задать или сгенерировать PIN номера")
@requires(WRITE)
def room_pin_set(request: HttpRequest, hotel_id: str, room_id: str, payload: RoomPinIn):
    return edit.set_pin(
        console.get_hotel(hotel_id), request.user, room_id,
        pin=payload.pin, generate=payload.generate, valid_until=payload.valid_until,
    )


@router.delete("/hotels/{hotel_id}/rooms/{room_id}/pin", summary="Снять PIN номера")
@requires(WRITE)
def room_pin_clear(request: HttpRequest, hotel_id: str, room_id: str):
    return edit.clear_pin(console.get_hotel(hotel_id), request.user, room_id)


@router.get("/hotels/{hotel_id}/rooms/{room_id}/history", summary="История номера")
@requires(READ)
def room_history(request: HttpRequest, hotel_id: str, room_id: str, limit: int = 50):
    return edit.room_history(console.get_hotel(hotel_id), room_id, limit)


@router.post("/hotels/{hotel_id}/buildings", response={201: dict}, summary="Завести корпус")
@requires(WRITE)
def building_create(request: HttpRequest, hotel_id: str, payload: RoomsDictionaryIn):
    return 201, edit.save_dictionary(console.get_hotel(hotel_id), request.user, "building", None, payload.dict())


@router.patch("/hotels/{hotel_id}/buildings/{item_id}", summary="Переименовать корпус")
@requires(WRITE)
def building_patch(request: HttpRequest, hotel_id: str, item_id: str, payload: RoomsDictionaryIn):
    return edit.save_dictionary(console.get_hotel(hotel_id), request.user, "building", item_id, payload.dict())


@router.delete("/hotels/{hotel_id}/buildings/{item_id}", summary="Удалить корпус (номера — перенести)")
@requires(WRITE)
def building_delete(request: HttpRequest, hotel_id: str, item_id: str, move_to: str = ""):
    return edit.delete_dictionary(console.get_hotel(hotel_id), request.user, "building", item_id, move_to or None)


@router.post("/hotels/{hotel_id}/room-categories", response={201: dict}, summary="Завести категорию номеров")
@requires(WRITE)
def category_create(request: HttpRequest, hotel_id: str, payload: RoomsDictionaryIn):
    return 201, edit.save_dictionary(console.get_hotel(hotel_id), request.user, "category", None, payload.dict())


@router.patch("/hotels/{hotel_id}/room-categories/{item_id}", summary="Переименовать категорию номеров")
@requires(WRITE)
def category_patch(request: HttpRequest, hotel_id: str, item_id: str, payload: RoomsDictionaryIn):
    return edit.save_dictionary(console.get_hotel(hotel_id), request.user, "category", item_id, payload.dict())


@router.delete("/hotels/{hotel_id}/room-categories/{item_id}", summary="Удалить категорию (номера — перенести)")
@requires(WRITE)
def category_delete(request: HttpRequest, hotel_id: str, item_id: str, move_to: str = ""):
    return edit.delete_dictionary(console.get_hotel(hotel_id), request.user, "category", item_id, move_to or None)
