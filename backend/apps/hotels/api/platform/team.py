"""Команда платформы: приглашение, роль, отключение."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.errors import PermissionDenied
from apps.hotels.schemas.platform import TeamInviteIn, TeamPatchIn
from apps.hotels.services.platform import console

router = Router(tags=["platform"])


@router.get("/team", summary="Команда платформы")
def list_team(request: HttpRequest):
    from apps.hotels.services.platform.team import list_members

    return list_members()


@router.post("/team", response={201: dict}, summary="Пригласить в команду платформы")
def invite_member(request: HttpRequest, payload: TeamInviteIn):
    from apps.accounts.services.platform_access import can_manage_team
    from apps.hotels.services.platform.team import invite

    if not can_manage_team(request.user):
        raise PermissionDenied("Команду платформы ведёт только владелец")
    member, password = invite(email=payload.email, role=payload.role, full_name=payload.full_name)
    console.audit_platform(
        "platform.team.invited",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"email": member.email, "role": member.platform_role},
    )
    return 201, {"member": console.member(member), "password": password}


@router.patch("/team/{user_id}", summary="Сменить роль или отключить участника")
def patch_member(request: HttpRequest, user_id: str, payload: TeamPatchIn):
    from apps.accounts.services.platform_access import can_manage_team
    from apps.hotels.services.platform.team import update_member

    if not can_manage_team(request.user):
        raise PermissionDenied("Команду платформы ведёт только владелец")
    member = update_member(
        user_id,
        role=payload.role,
        is_active=payload.is_active,
        actor_id=request.user.pk,
    )
    console.audit_platform(
        "platform.team.updated",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"email": member.email, "role": member.platform_role, "active": member.is_active},
    )
    return console.member(member)
