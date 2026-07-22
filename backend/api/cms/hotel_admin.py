"""
CMS: номера/QR, локации, отделы, персонал.
Контракт — docs/hotel-admin-api-contract.md.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest, HttpResponse
from ninja import Field, Router, Schema

from apps.accounts import cms_services as staff_svc
from apps.core.context import current_language
from apps.hotels import admin_services as svc
from apps.hotels import qr

from .schemas import OkOut

router = Router(tags=["cms:hotel-admin"])


# --- Схемы -----------------------------------------------------------------


class RoomIn(Schema):
    number: str
    floor: str = ""
    zone: str = ""
    is_active: bool = True


class RoomPatch(Schema):
    number: str | None = None
    floor: str | None = None
    zone: str | None = None
    is_active: bool | None = None


class RoomOut(Schema):
    id: str
    number: str
    floor: str
    zone: str
    source: str
    is_active: bool
    guest_url: str


class BulkRoomsIn(Schema):
    # `from` — ключевое слово Python; принимаем его по alias, в коде — from_.
    from_: int = Field(alias="from")
    to: int
    floor: str = ""
    zone: str = ""
    prefix: str = ""
    suffix: str = ""


class LocationIn(Schema):
    title: dict[str, str]
    code: str | None = None
    kind: str = "in_room"
    requires_refinement: bool = False
    refinement_label: dict[str, str] = {}
    schedule_id: str | None = None
    sort_order: int = 0
    is_active: bool = True


class LocationPatch(Schema):
    title: dict[str, str] | None = None
    kind: str | None = None
    requires_refinement: bool | None = None
    refinement_label: dict[str, str] | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class MatrixCell(Schema):
    location_id: str
    enabled: bool = False
    delivery_modes: list[str] = []


class MatrixRowIn(Schema):
    category_id: str
    cells: list[MatrixCell]


class DepartmentIn(Schema):
    title: dict[str, str]
    code: str | None = None
    kind: str = "other"
    schedule_id: str | None = None
    sla_minutes: int = 20
    is_active: bool = True


class DepartmentPatch(Schema):
    title: dict[str, str] | None = None
    kind: str | None = None
    schedule_id: str | None = None
    sla_minutes: int | None = None
    is_active: bool | None = None


class AssignmentIn(Schema):
    execution_point_id: str
    level: str = "member"


class StaffIn(Schema):
    email: str
    full_name: str = ""
    password: str
    language: str = ""
    is_hotel_admin: bool = False
    assignments: list[AssignmentIn] = []


class StaffPatch(Schema):
    email: str | None = None
    full_name: str | None = None
    password: str | None = None
    language: str | None = None
    is_hotel_admin: bool | None = None
    is_active: bool | None = None
    assignments: list[AssignmentIn] | None = None


class AssignmentsIn(Schema):
    assignments: list[AssignmentIn]


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
    pairs = [(room.number, hotel.public_guest_url(f"/r/{room.number}")) for room in rooms]
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
    url = room.hotel.public_guest_url(f"/r/{room.number}")
    return HttpResponse(qr.qr_svg(url), content_type="image/svg+xml")


@router.get("/rooms/{room_id}/qr.png", summary="QR номера (PNG)")
def room_qr_png(request: HttpRequest, room_id: str):
    room = svc.get_room(room_id)
    url = room.hotel.public_guest_url(f"/r/{room.number}")
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




# --- Отделы ----------------------------------------------------------------


@router.get("/departments", summary="Список отделов")
def list_departments(request: HttpRequest):
    return svc.list_departments()


@router.post("/departments", response={201: dict}, summary="Создать отдел")
def create_department(request: HttpRequest, payload: DepartmentIn):
    return 201, svc.serialize_department(svc.create_department(payload.dict()))


@router.patch("/departments/{point_id}", summary="Изменить отдел")
def update_department(request: HttpRequest, point_id: str, payload: DepartmentPatch):
    return svc.serialize_department(svc.update_department(point_id, payload.dict(exclude_unset=True)))


@router.delete("/departments/{point_id}", response=OkOut, summary="Удалить отдел")
def delete_department(request: HttpRequest, point_id: str):
    svc.delete_department(point_id)
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
