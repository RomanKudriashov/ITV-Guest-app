"""
CMS: номера/QR, локации, СЕРВИСЫ, персонал.
Контракт — docs/hotel-admin-api-contract.md.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest, HttpResponse
from ninja import Router
from apps.accounts.schemas.cms import AssignmentsIn, StaffIn, StaffPatch
from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import (
    BulkRoomsIn,
    LocationIn,
    LocationPatch,
    MatrixRowIn,
    RoomIn,
    RoomOut,
    RoomPatch,
    ServiceIn,
    ServicePatch,
)

from apps.accounts import cms_services as staff_svc
from apps.core.context import current_language
from apps.hotels import admin_services as svc
from apps.hotels import qr


router = Router(tags=["cms:hotel-admin"])


# --- Схемы -----------------------------------------------------------------






























# --- Номера ----------------------------------------------------------------


@router.get("/rooms", response=list[RoomOut], summary="Список номеров")
def list_rooms(request: HttpRequest):
    return svc.list_rooms()


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
    return HttpResponse(qr.qr_sheet_html(hotel.name, pairs), content_type="text/html")


@router.patch("/rooms/{room_id}", response=RoomOut, summary="Изменить номер")
def update_room(request: HttpRequest, room_id: str, payload: RoomPatch):
    return svc.serialize_room(svc.update_room(room_id, payload.dict(exclude_unset=True)))


@router.delete("/rooms/{room_id}", response=OkOut, summary="Удалить номер")
def delete_room(request: HttpRequest, room_id: str):
    svc.delete_room(room_id)
    return {"ok": True}


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




# --- Локации ---------------------------------------------------------------


@router.get("/locations", summary="Список локаций")
def list_locations(request: HttpRequest):
    return svc.list_locations()


@router.post("/locations", response={201: dict}, summary="Создать локацию")
def create_location(request: HttpRequest, payload: LocationIn):
    return 201, svc.serialize_location(svc.create_location(payload.dict()))


@router.get("/locations/matrix", summary="Матрица категория → локации")
def get_matrix(request: HttpRequest):
    return svc.location_matrix(current_language())


@router.put("/locations/matrix", summary="Обновить строку матрицы")
def put_matrix(request: HttpRequest, payload: MatrixRowIn):
    return svc.update_matrix_row(payload.category_id, [cell.dict() for cell in payload.cells])


@router.patch("/locations/{location_id}", summary="Изменить локацию")
def update_location(request: HttpRequest, location_id: str, payload: LocationPatch):
    return svc.serialize_location(svc.update_location(location_id, payload.dict(exclude_unset=True)))


@router.delete("/locations/{location_id}", response=OkOut, summary="Удалить локацию")
def delete_location(request: HttpRequest, location_id: str):
    svc.delete_location(location_id)
    return {"ok": True}




# --- Сервисы (верхний уровень CMS) ------------------------------------------


# ВНИМАНИЕ: статический `/services/templates` объявляется РАНЬШЕ
# параметризованного `/services/{id}` — иначе слово "templates" уедет в id.
@router.get("/services/templates", summary="Шаблоны для «+ добавить сервис»")
def cms_service_templates(request: HttpRequest):
    return svc.service_templates()


@router.get("/services", summary="Сервисы отеля (верхний уровень CMS)")
def cms_list_services(request: HttpRequest):
    return svc.list_services()


@router.post("/services", response={201: dict}, summary="Создать сервис из шаблона")
def cms_create_service(request: HttpRequest, payload: ServiceIn):
    service = svc.create_service(payload.dict(exclude_unset=True))
    return 201, svc.serialize_service(service)


@router.get("/services/{service_id}", summary="Сервис")
def cms_get_service(request: HttpRequest, service_id: str):
    return svc.serialize_service(svc.get_service(service_id))


@router.patch("/services/{service_id}", summary="Изменить сервис")
def cms_update_service(request: HttpRequest, service_id: str, payload: ServicePatch):
    return svc.serialize_service(svc.update_service(service_id, payload.dict(exclude_unset=True)))


@router.delete("/services/{service_id}", response=OkOut, summary="Удалить сервис")
def cms_delete_service(request: HttpRequest, service_id: str):
    svc.delete_service(service_id)
    return {"ok": True}


# --- Персонал --------------------------------------------------------------


@router.get("/staff", summary="Список сотрудников")
def list_staff(request: HttpRequest):
    return staff_svc.list_staff()


@router.post("/staff", response={201: dict}, summary="Создать сотрудника")
def create_staff(request: HttpRequest, payload: StaffIn):
    return 201, staff_svc.serialize_staff(staff_svc.create_staff(payload.dict()))


@router.patch("/staff/{user_id}", summary="Изменить сотрудника")
def update_staff(request: HttpRequest, user_id: str, payload: StaffPatch):
    user = staff_svc.update_staff(
        user_id, payload.dict(exclude_unset=True), acting_user_id=request.user.pk
    )
    return staff_svc.serialize_staff(user)


@router.delete("/staff/{user_id}", response=OkOut, summary="Удалить сотрудника")
def delete_staff(request: HttpRequest, user_id: str):
    staff_svc.delete_staff(user_id, acting_user_id=request.user.pk)
    return {"ok": True}


@router.put("/staff/{user_id}/assignments", summary="Заменить привязки")
def put_assignments(request: HttpRequest, user_id: str, payload: AssignmentsIn):
    user = staff_svc.replace_assignments(user_id, [a.dict() for a in payload.assignments])
    return staff_svc.serialize_staff(user)
