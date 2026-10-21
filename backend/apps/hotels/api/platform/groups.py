"""
Группы отелей — ручки консоли (партия 62-A1: группа = отели одного владельца).

Права: смотреть может любой член команды (`READ`), менять — поддержка и
владелец (`WRITE`). В CMS отеля этих адресов нет и не появится.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import GroupIn, GroupMembersIn, GroupMoveIn
from apps.hotels.services.platform import console, groups as groups_svc, scope

router = PlatformRouter(tags=["platform"])


def _audit(request: HttpRequest, action: str, payload: dict) -> None:
    console.audit_platform(action, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"), payload=payload)


@router.get("/groups", summary="Группы отелей")
@requires(READ)
def list_groups(request: HttpRequest):
    from apps.hotels.models import HotelGroup

    return {
        "items": [groups_svc.serialize(group) for group in groups_svc.all_groups(request.user)],
        "colors": [{"code": code, "title": title} for code, title in HotelGroup.Color.choices],
    }


@router.post("/groups", response={201: dict}, summary="Создать группу (сразу с отелями)")
@requires(WRITE)
def create_group(request: HttpRequest, payload: GroupIn):
    data = payload.dict(exclude_unset=True)
    if data.get("hotel_ids"):
        # Чужой отель в свою группу — это расширение собственной области.
        scope.assert_within(request.user, data["hotel_ids"])
    group = groups_svc.create(data, actor_id=request.user.pk)
    _audit(request, "platform.group.created", {"code": group.code, "title": group.title, "hotels": len(data.get("hotel_ids") or [])})
    return 201, groups_svc.serialize(group)


@router.post("/groups/move", summary="Перенести отели в группу или убрать из группы")
@requires(WRITE)
def move_hotels(request: HttpRequest, payload: GroupMoveIn):
    group = groups_svc.get(payload.group_id, request.user) if payload.group_id else None
    scope.assert_within(request.user, payload.hotel_ids)
    moves = groups_svc.move(payload.hotel_ids, group, actor_id=request.user.pk)
    if moves:
        _audit(request, "platform.group.hotels_moved", {"code": group.code if group else "", "moves": moves})
    return {"moved": len(moves), "moves": moves}


@router.patch("/groups/{group_id}", summary="Изменить группу")
@requires(WRITE)
def patch_group(request: HttpRequest, group_id: str, payload: GroupIn):
    group = groups_svc.get(group_id, request.user)
    changes = groups_svc.update(group, payload.dict(exclude_unset=True))
    if changes:
        _audit(request, "platform.group.updated", {"code": group.code, "changes": changes})
    return groups_svc.serialize(group)


@router.delete("/groups/{group_id}", summary="Удалить группу (отели уходят в «без группы»)")
@requires(WRITE)
def delete_group(request: HttpRequest, group_id: str, confirm_title: str = ""):
    scope.assert_may_shape_scope(request.user)
    group = groups_svc.get(group_id, request.user)
    code, title = group.code, group.title
    released = groups_svc.delete(group, confirm_title)
    _audit(request, "platform.group.deleted", {"code": code, "title": title, "released": released})
    return {"ok": True, "released": released}


@router.get("/groups/{group_id}/members", summary="Состав группы")
@requires(READ)
def group_members(request: HttpRequest, group_id: str):
    group = groups_svc.get(group_id, request.user)
    return {"group": groups_svc.serialize(group), "members": groups_svc.members(group)}


@router.post("/groups/{group_id}/members", summary="Добавить отели в группу (переносом)")
@requires(WRITE)
def add_group_members(request: HttpRequest, group_id: str, payload: GroupMembersIn):
    group = groups_svc.get(group_id, request.user)
    scope.assert_within(request.user, payload.hotel_ids)
    moves = groups_svc.move(payload.hotel_ids, group, actor_id=request.user.pk)
    if moves:
        _audit(request, "platform.group.hotels_moved", {"code": group.code, "moves": moves})
    return {"added": len(moves), "moves": moves, "size": groups_svc.queryset(group).count()}


@router.delete("/groups/{group_id}/members/{hotel_id}", summary="Убрать отель из группы")
@requires(WRITE)
def remove_group_member(request: HttpRequest, group_id: str, hotel_id: str):
    group = groups_svc.get(group_id, request.user)
    scope.assert_within(request.user, [hotel_id])
    removed = groups_svc.remove_member(group, hotel_id)
    if removed:
        _audit(request, "platform.group.hotels_moved", {"code": group.code, "moves": [{"hotel_id": hotel_id, "from": group.title, "to": ""}]})
    return {"removed": removed, "size": groups_svc.queryset(group).count()}
