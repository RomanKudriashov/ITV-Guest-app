"""CMS: расписания доступности."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import ScheduleIn, ScheduleOut, SchedulePatch
from apps.hotels.services import schedules as schedule_svc

router = Router(tags=["cms"])


@router.get("/schedules", response=list[ScheduleOut], summary="Расписания")
def list_schedules(request: HttpRequest):
    return schedule_svc.list_schedules()


@router.post("/schedules", response={201: ScheduleOut}, summary="Создать расписание")
def create_schedule(request: HttpRequest, payload: ScheduleIn):
    schedule = schedule_svc.create_schedule(payload.dict(exclude_unset=True))
    return 201, schedule_svc.serialize_schedule(schedule)


@router.patch("/schedules/{schedule_id}", response=ScheduleOut, summary="Изменить расписание")
def update_schedule(request: HttpRequest, schedule_id: str, payload: SchedulePatch):
    schedule = schedule_svc.update_schedule(schedule_id, payload.dict(exclude_unset=True))
    return schedule_svc.serialize_schedule(schedule)


@router.delete("/schedules/{schedule_id}", response=OkOut, summary="Удалить расписание")
def delete_schedule(request: HttpRequest, schedule_id: str):
    schedule_svc.delete_schedule(schedule_id)
    return {"ok": True}
