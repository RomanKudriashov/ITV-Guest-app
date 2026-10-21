"""
Группы отелей — ручки консоли (партия 62-A1: группа = отели одного владельца).

Права: смотреть может любой член команды (`READ`), менять — поддержка и
владелец (`WRITE`). В CMS отеля этих адресов нет и не появится.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import GroupActionIn, GroupDefaultsIn, GroupIn, GroupMembersIn, GroupMoveIn
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
    _audit(
        request,
        "platform.group.created",
        {
            "code": group.code,
            "title": group.title,
            "group_ids": [str(group.pk)],
            "hotels": [h.subdomain for h in groups_svc.queryset(group)],
        },
    )
    moves = [m for m in group.created_moves if m["from_id"]]
    if moves:
        _audit(request, "platform.group.hotels_moved", {"code": group.code, "moves": moves, "group_ids": groups_svc.group_ids_of(moves)})
    return 201, groups_svc.serialize(group)


@router.post("/groups/move", summary="Перенести отели в группу или убрать из группы")
@requires(WRITE)
def move_hotels(request: HttpRequest, payload: GroupMoveIn):
    group = groups_svc.get(payload.group_id, request.user) if payload.group_id else None
    scope.assert_within(request.user, payload.hotel_ids)
    moves = groups_svc.move(payload.hotel_ids, group, actor_id=request.user.pk)
    if moves:
        _audit(request, "platform.group.hotels_moved", {"code": group.code if group else "", "moves": moves, "group_ids": groups_svc.group_ids_of(moves)})
        # И в «Историю» каждого отеля: «группа: было → стало» (партия 62-C).
        for row in moves:
            console.audit_hotel(
                console.get_hotel(row["hotel_id"]),
                "platform.hotel.updated",
                actor_id=request.user.pk,
                ip=request.META.get("REMOTE_ADDR"),
                payload={"fields": ["group"], "changes": {"group": {"from": row.get("from"), "to": row.get("to")}}},
            )
    return {"moved": len(moves), "moves": moves}


@router.patch("/groups/{group_id}", summary="Изменить группу")
@requires(WRITE)
def patch_group(request: HttpRequest, group_id: str, payload: GroupIn):
    group = groups_svc.get(group_id, request.user)
    changes = groups_svc.update(group, payload.dict(exclude_unset=True))
    if changes:
        _audit(request, "platform.group.updated", {"code": group.code, "changes": changes, "group_ids": [str(group.pk)]})
    return groups_svc.serialize(group)


@router.delete("/groups/{group_id}", summary="Удалить группу (отели уходят в «без группы»)")
@requires(WRITE)
def delete_group(request: HttpRequest, group_id: str, confirm_title: str = ""):
    scope.assert_may_shape_scope(request.user)
    group = groups_svc.get(group_id, request.user)
    code, title, gid = group.code, group.title, str(group.pk)
    released = groups_svc.delete(group, confirm_title)
    _audit(request, "platform.group.deleted", {"code": code, "title": title, "released": released, "group_ids": [gid]})
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
        _audit(request, "platform.group.hotels_moved", {"code": group.code, "moves": moves, "group_ids": groups_svc.group_ids_of(moves)})
    return {"added": len(moves), "moves": moves, "size": groups_svc.queryset(group).count()}


@router.delete("/groups/{group_id}/members/{hotel_id}", summary="Убрать отель из группы")
@requires(WRITE)
def remove_group_member(request: HttpRequest, group_id: str, hotel_id: str):
    group = groups_svc.get(group_id, request.user)
    scope.assert_within(request.user, [hotel_id])
    hotel = groups_svc.queryset(group).filter(pk=hotel_id).first()
    removed = groups_svc.remove_member(group, hotel_id)
    if removed:
        move = {"hotel": hotel.subdomain if hotel else "", "hotel_id": hotel_id, "from": group.title, "from_id": str(group.pk), "to": "", "to_id": "", "modules_enabled": []}
        _audit(request, "platform.group.hotels_moved", {"code": group.code, "moves": [move], "group_ids": [str(group.pk)]})
    return {"removed": removed, "size": groups_svc.queryset(group).count()}


@router.get("/groups/{group_id}", summary="Страница группы: профиль, сводка, отели")
@requires(READ)
def group_detail(request: HttpRequest, group_id: str):
    return groups_svc.summary(groups_svc.get(group_id, request.user), request.user)


@router.get("/groups/{group_id}/history", summary="История группы: кто, когда, было → стало")
@requires(READ)
def group_history(request: HttpRequest, group_id: str):
    return {"items": groups_svc.history(groups_svc.get(group_id, request.user))}


@router.post("/groups/{group_id}/actions/preview", summary="Действие по группе: что изменится у каждого отеля")
@requires(WRITE)
def group_action_preview(request: HttpRequest, group_id: str, payload: GroupActionIn):
    group = groups_svc.get(group_id, request.user)
    return groups_svc.preview_action(group, payload.kind, payload.module)


@router.post("/groups/{group_id}/actions", summary="Действие по группе: выполнить показанное")
@requires(WRITE)
def group_action(request: HttpRequest, group_id: str, payload: GroupActionIn):
    group = groups_svc.get(group_id, request.user)
    scope.assert_within(request.user, groups_svc.hotel_ids(group))
    ip = request.META.get("REMOTE_ADDR")
    changed = groups_svc.run_action(
        group, payload.kind, payload.module, payload.hotel_ids, payload.reason, actor_id=request.user.pk, ip=ip
    )
    # Отключение и включение журнал пишут сами (`activation`); модули — здесь.
    for row in changed:
        if payload.kind in ("module_on", "module_off"):
            console.audit_hotel(
                console.get_hotel(row["hotel_id"]),
                "platform.hotel.modules_set",
                actor_id=request.user.pk,
                ip=ip,
                payload={"module": payload.module, "from": row["before"], "to": row["after"], "group": group.code},
            )
    _audit(
        request,
        "platform.group.action",
        {
            "code": group.code,
            "group_ids": [str(group.pk)],
            "kind": payload.kind,
            "module": payload.module,
            "reason": payload.reason,
            "changed": [row["subdomain"] for row in changed],
        },
    )
    return {"changed": changed}


@router.put("/groups/{group_id}/defaults", summary="Умолчания для новых отелей группы")
@requires(WRITE)
def group_defaults(request: HttpRequest, group_id: str, payload: GroupDefaultsIn):
    group = groups_svc.get(group_id, request.user)
    changes = groups_svc.set_defaults(group, payload.enabled, payload.modules)
    if changes:
        _audit(request, "platform.group.defaults_set", {"code": group.code, "changes": changes, "group_ids": [str(group.pk)]})
    return groups_svc.serialize(group)
