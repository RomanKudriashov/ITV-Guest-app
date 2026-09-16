"""CMS: номера отеля и их QR."""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import (
    BulkRoomsIn,
    BulkRoomsPreviewOut,
    BulkUpdateIn,
    BulkUpdateOut,
    RoomCategoryIn,
    RoomCategoryOut,
    RoomCategoryPatch,
    RoomIn,
    RoomOut,
    RoomPatch,
    RoomRenameImpactOut,
)
from apps.hotels.services import admin_services as svc
from apps.hotels.services import qr
from apps.hotels.services.hotel import current_hotel

router = Router(tags=["cms:hotel-admin"])


@router.get("/rooms", summary="Список номеров")
def list_rooms(
    request: HttpRequest,
    search: str = "",
    limit: int | None = None,
    offset: int = 0,
    floor: str = "",
    zone: str = "",
    category: str = "",
    housekeeping: str = "",
    out_of_service: bool | None = None,
    has_orders: bool = False,
    has_control: bool = False,
):
    """Выдача в ОБОЛОЧКЕ (`items/total/limit`): голый массив без предела
    выглядит полным, сколько бы записей ни осталось за его границей.

    Фильтры — те же, по которым массовая правка строит «все по выборке»:
    два разных множества под одним словом «выборка» это готовая ошибка."""
    return svc.list_rooms(
        search=search,
        limit=limit,
        offset=offset,
        filters={
            "floor": floor,
            "zone": zone,
            "category": category,
            "housekeeping": housekeeping,
            "out_of_service": out_of_service,
            "has_orders": has_orders,
            "has_control": has_control,
        },
    )


@router.get("/rooms/grid", summary="Сетка фонда: корпуса, этажи, кубики")
def rooms_grid(request: HttpRequest):
    """
    Весь фонд разом, без листания: сетка тем и полезна, что этажи читаются один
    под другим. Фильтры не принимаются — на сетке отфильтрованное гасится, а не
    исчезает, и гасит это клиент.
    """
    return svc.rooms_grid()


@router.post(
    "/rooms/bulk/preview",
    response=BulkRoomsPreviewOut,
    summary="Предпросмотр заведения пачкой (ничего не создаёт)",
)
def bulk_rooms_preview(request: HttpRequest, payload: BulkRoomsIn):
    """
    Показать список ДО создания. Отдельная ручка, а не флаг у создания: флаг
    однажды забудут передать, и опечатка «1-99999» создаст фонд на девяносто
    тысяч комнат.
    """
    return svc.preview_bulk_rooms(payload.dict(by_alias=True))


@router.post("/rooms/bulk-update", response=BulkUpdateOut, summary="Правка пачкой")
def bulk_update_rooms(request: HttpRequest, payload: BulkUpdateIn):
    """
    Выборка задаётся ИДЕНТИФИКАТОРАМИ или признаком «все по фильтрам», и во
    втором случае множество строит сервер — клиент его целиком не видел.
    Номер пачкой не меняется (см. сервис).
    """
    return svc.bulk_update_rooms(payload.dict())


# --- Категории номеров -----------------------------------------------------


@router.get("/room-categories", summary="Категории номеров")
def list_room_categories(request: HttpRequest):
    return svc.list_room_categories()


@router.post(
    "/room-categories", response={201: RoomCategoryOut}, summary="Завести категорию"
)
def create_room_category(request: HttpRequest, payload: RoomCategoryIn):
    return 201, svc.serialize_room_category(svc.create_room_category(payload.dict()))


@router.patch(
    "/room-categories/{category_id}", response=RoomCategoryOut, summary="Изменить категорию"
)
def update_room_category(request: HttpRequest, category_id: str, payload: RoomCategoryPatch):
    return svc.serialize_room_category(
        svc.update_room_category(category_id, payload.dict(exclude_unset=True))
    )


@router.delete("/room-categories/{category_id}", response=OkOut, summary="Удалить категорию")
def delete_room_category(request: HttpRequest, category_id: str):
    svc.delete_room_category(category_id)
    return {"ok": True}


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


@router.get(
    "/rooms/{room_id}/rename-check",
    response=RoomRenameImpactOut,
    summary="Что изменится при переименовании номера",
)
def rename_check(request: HttpRequest, room_id: str, number: str):
    """
    Только чтение: диалогу переименования нужно ЧИСЛАМИ показать последствия —
    какая ссылка QR перестанет работать и на какое имя уедет устройство iRidi.
    """
    return svc.rename_impact(room_id, number)


@router.patch("/rooms/{room_id}", response=RoomOut, summary="Изменить номер")
def update_room(request: HttpRequest, room_id: str, payload: RoomPatch):
    """
    Смена номера требует `confirm_rename`: без него — 409
    `rename_needs_confirmation` с тем же разбором последствий в `impact`.
    Молча переименовывать нельзя, см. `services.admin_services.update_room`.
    """
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
