"""
CMS: сотрудники отеля и их привязки к сервисам.

Вьюхи жили в api/cms/hotel_admin.py вместе с номерами и локациями — файл резался
по экрану редактора, а не по домену. Логика персонала при переезде не менялась:
она была и осталась в apps/accounts/cms_services.py.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services import cms_services as staff_svc
from apps.accounts.schemas.cms import AssignmentsIn, StaffIn, StaffPatch
from apps.core.schemas import OkOut

router = Router(tags=["cms:hotel-admin"])


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
