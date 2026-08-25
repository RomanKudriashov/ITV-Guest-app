"""CMS: номера отеля и их QR."""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import BulkRoomsIn, RoomIn, RoomOut, RoomPatch
from apps.hotels.services import admin_services as svc
from apps.hotels.services import qr
from apps.hotels.services.hotel import current_hotel

router = Router(tags=["cms:hotel-admin"])


@router.get("/rooms", summary="Список номеров")
def list_rooms(
    request: HttpRequest, search: str = "", limit: int | None = None, offset: int = 0
):
    """Выдача в ОБОЛОЧКЕ (`items/total/limit`): голый массив без предела
    выглядит полным, сколько бы записей ни осталось за его границей."""
    return svc.list_rooms(search=search, limit=limit, offset=offset)


@router.post("/rooms", response={201: RoomOut}, summary="Добавить номер")
def create_room(request: HttpRequest, payload: RoomIn):
    return 201, svc.serialize_room(svc.create_room(payload.dict()))


@router.post("/rooms/bulk", summary="Добавить номера диапазоном")
def bulk_rooms(request: HttpRequest, payload: BulkRoomsIn):
    return svc.bulk_create_rooms(payload.dict(by_alias=True))


@router.get("/rooms/qr-sheet", summary="Печатный лист всех QR")
def rooms_qr_sheet(request: HttpRequest):
    hotel, rooms = svc.room_qr_targets()
    pairs = [(room.number, hotel.room_deeplink(room.number)) for room in rooms]
    return HttpResponse(qr.qr_sheet_html(hotel.name_i18n, pairs), content_type="text/html")


@router.patch("/rooms/{room_id}", response=RoomOut, summary="Изменить номер")
def update_room(request: HttpRequest, room_id: str, payload: RoomPatch):
    return svc.serialize_room(svc.update_room(room_id, payload.dict(exclude_unset=True)))


@router.delete("/rooms/{room_id}", response=OkOut, summary="Удалить номер")
def delete_room(request: HttpRequest, room_id: str):
    svc.delete_room(room_id)
    return {"ok": True}


@router.post("/rooms/{room_id}/checkout", summary="Отметить выезд гостя из номера")
def check_out_room(request: HttpRequest, room_id: str):
    """
    ВЫЕЗД ОТМЕЧАЕТСЯ ЯВНО, а не смены PIN ради.

    Раньше единственным способом отобрать доступ была смена кода номера:
    ресепшен решал задачу «гость съехал», а нажимал «сменить код». Если код
    менять не собирались — выехавший продолжал заказывать и управлять номером
    до конца двенадцатичасовой сессии, из любой точки мира.

    Отзыв гасит гостевые сессии ЦЕЛИКОМ, не только управление номером: право
    заказывать уезжает вместе с ними. Поэтому действие живёт в номерном фонде,
    а не в разделе управления номером, — отелю без оборудования выезд нужен
    ровно так же.
    """
    from apps.accounts.services.guest_checkout import check_out_room as revoke

    require_hotel_admin()
    room = svc.get_room(room_id)
    result = revoke(current_hotel(), room, actor_id=getattr(request.user, "pk", None))
    return {
        "room": room.number,
        "revoked": result.revoked,
        "verified_revoked": result.verified_revoked,
    }


@router.get("/rooms/{room_id}/qr.svg", summary="QR номера (SVG)")
def room_qr_svg(request: HttpRequest, room_id: str):
    room = svc.get_room(room_id)
    url = room.hotel.room_deeplink(room.number)
    return HttpResponse(qr.qr_svg(url), content_type="image/svg+xml")


@router.get("/rooms/{room_id}/qr.png", summary="QR номера (PNG)")
def room_qr_png(request: HttpRequest, room_id: str):
    room = svc.get_room(room_id)
    url = room.hotel.room_deeplink(room.number)
    return HttpResponse(qr.qr_png(url), content_type="image/png")
