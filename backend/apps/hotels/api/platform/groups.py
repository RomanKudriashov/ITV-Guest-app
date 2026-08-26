"""
Группы отелей — ручки консоли.

Права: смотреть может любой член команды (`READ`), менять — поддержка и
владелец (`WRITE`). Группа не про деньги и не про состав команды, поэтому
владельческого права не требует; но и «только чтение» её не правит.

В CMS отеля этих адресов нет и не появится: группы — инструмент платформы,
отель о них не знает.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import GroupIn, GroupMembersIn
from apps.hotels.services.platform import console, groups as groups_svc

router = PlatformRouter(tags=["platform"])


@router.get("/groups", summary="Группы отелей")
@requires(READ)
def list_groups(request: HttpRequest):
    from apps.hotels.models import HotelGroup

    return {
        "items": [groups_svc.serialize(group) for group in groups_svc.all_groups()],
        "kinds": [
            {"code": code, "title": title} for code, title in HotelGroup.Kind.choices
        ],
        "rule_fields": list(groups_svc.RULE_FIELDS),
    }


@router.post("/groups", response={201: dict}, summary="Создать группу")
@requires(WRITE)
def create_group(request: HttpRequest, payload: GroupIn):
    group = groups_svc.create(payload.dict(exclude_unset=True))
    console.audit_platform(
        "platform.group.created",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": group.code, "mode": group.mode},
    )
    return 201, groups_svc.serialize(group)


@router.patch("/groups/{group_id}", summary="Изменить группу")
@requires(WRITE)
def patch_group(request: HttpRequest, group_id: str, payload: GroupIn):
    group = groups_svc.update(groups_svc.get(group_id), payload.dict(exclude_unset=True))

    console.audit_platform(
        "platform.group.updated",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": group.code, "mode": group.mode},
    )
    return groups_svc.serialize(group)


@router.delete("/groups/{group_id}", summary="Удалить группу")
@requires(WRITE)
def delete_group(request: HttpRequest, group_id: str):
    code = groups_svc.delete(groups_svc.get(group_id))
    console.audit_platform(
        "platform.group.deleted",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": code},
    )
    return {"ok": True}


@router.get("/groups/{group_id}/members", summary="Состав группы")
@requires(READ)
def group_members(request: HttpRequest, group_id: str):
    group = groups_svc.get(group_id)
    return {
        "group": groups_svc.serialize(group),
        # У правила состав ВЫЧИСЛЕН сейчас, у списка — сложен руками, и в нём
        # есть ответ на «кто и когда добавил». Экран различает их по `mode`.
        "members": groups_svc.members(group),
    }


@router.post("/groups/{group_id}/members", summary="Добавить отели в группу")
@requires(WRITE)
def add_group_members(request: HttpRequest, group_id: str, payload: GroupMembersIn):
    group = groups_svc.get(group_id)
    added = groups_svc.add_members(group, payload.hotel_ids, actor_id=request.user.pk)
    console.audit_platform(
        "platform.group.members_added",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": group.code, "requested": len(payload.hotel_ids), "added": added},
    )
    return {"added": added, "size": groups_svc.queryset(group).count()}


@router.delete("/groups/{group_id}/members/{hotel_id}", summary="Убрать отель из группы")
@requires(WRITE)
def remove_group_member(request: HttpRequest, group_id: str, hotel_id: str):
    group = groups_svc.get(group_id)
    removed = groups_svc.remove_member(group, hotel_id)
    console.audit_platform(
        "platform.group.member_removed",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": group.code, "hotel_id": hotel_id, "removed": removed},
    )
    return {"removed": removed, "size": groups_svc.queryset(group).count()}
