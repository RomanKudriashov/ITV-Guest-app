"""Команда платформы: приглашение, роль, отключение."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import TeamInviteIn, TeamPatchIn
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/team", summary="Команда платформы")
@requires(READ)
def list_team(
    request: HttpRequest, limit: int = 100, search: str = "", role: str = "", active: str = "", twofa: str = ""
):
    from apps.hotels.services.platform.team import list_members

    return list_members(limit=limit, search=search, user=request.user, role=role, active=active, twofa=twofa)


@router.post("/team", response={201: dict}, summary="Пригласить в команду платформы")
@requires(OWNER)
def invite_member(request: HttpRequest, payload: TeamInviteIn):
    from apps.hotels.services.platform.team import invite

    member, password = invite(email=payload.email, role=payload.role, full_name=payload.full_name)
    console.audit_platform(
        "platform.team.invited",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"email": member.email, "role": member.platform_role},
    )
    return 201, {"member": console.member(member), "password": password}


@router.patch("/team/{user_id}", summary="Сменить роль или отключить участника")
@requires(OWNER)
def patch_member(request: HttpRequest, user_id: str, payload: TeamPatchIn):
    from apps.hotels.services.platform.team import update_member

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


@router.post("/team/{user_id}/2fa/reset", summary="Сбросить второй фактор участнику")
@requires(OWNER)
def reset_member_two_factor(request: HttpRequest, user_id: str):
    """
    Владелец снимает 2FA другому участнику (партия 60): потерял телефон — без
    этого его учётка была заперта навсегда. Себе — нельзя (только командой
    `manage.py reset_platform_2fa`). Входы участника обрываются.
    """
    from apps.hotels.services.platform.team import reset_two_factor

    member = reset_two_factor(user_id=user_id, actor_id=request.user.pk)
    console.audit_platform(
        "platform.2fa.reset",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"email": member.email, "via": "console"},
    )
    return console.member(member)
