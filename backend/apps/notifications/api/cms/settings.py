"""
CMS: каналы уведомлений, правила эскалации, журнал.
Контракт — docs/notifications-api-contract.md.
"""

from __future__ import annotations


from django.http import HttpRequest
from ninja import Router
from apps.core.schemas import OkOut

from apps.notifications.schemas import ChannelIn, ChannelOut, ChannelPatch, LogOut, RuleIn, RuleOut, RulePatch, TestOut
from apps.notifications.services import cms as svc
from apps.notifications.services import send_test_message


router = Router(tags=["cms:notifications"])


# --- Схемы -----------------------------------------------------------------


@router.get("/notification-channels", summary="Каналы уведомлений")
def list_channels(
    request: HttpRequest, search: str = "", limit: int | None = None, offset: int = 0
):
    return svc.list_channels(search=search, limit=limit, offset=offset)


@router.post(
    "/notification-channels", response={201: ChannelOut}, summary="Создать канал"
)
def create_channel(request: HttpRequest, payload: ChannelIn):
    channel = svc.create_channel(payload.dict(exclude_unset=True))
    return 201, svc.serialize_channel(channel)


@router.patch(
    "/notification-channels/{channel_id}", response=ChannelOut, summary="Изменить канал"
)
def update_channel(request: HttpRequest, channel_id: str, payload: ChannelPatch):
    channel = svc.update_channel(channel_id, payload.dict(exclude_unset=True))
    return svc.serialize_channel(channel)


@router.delete("/notification-channels/{channel_id}", response=OkOut, summary="Удалить канал")
def delete_channel(request: HttpRequest, channel_id: str):
    svc.delete_channel(channel_id)
    return {"ok": True}


@router.post(
    "/notification-channels/{channel_id}/test",
    response=TestOut,
    summary="Отправить пробное сообщение",
)
def test_channel(request: HttpRequest, channel_id: str):
    """Настраивать канал вслепую и узнавать про опечатку из первой заявки — плохо."""
    return send_test_message(svc.get_channel(channel_id))


# --- Правила ---------------------------------------------------------------


@router.get("/escalation-rules", summary="Правила эскалации")
def list_rules(
    request: HttpRequest, search: str = "", limit: int | None = None, offset: int = 0
):
    return svc.list_rules(search=search, limit=limit, offset=offset)


@router.post("/escalation-rules", response={201: RuleOut}, summary="Создать правило")
def create_rule(request: HttpRequest, payload: RuleIn):
    rule = svc.create_rule(payload.dict(exclude_unset=True))
    return 201, svc.serialize_rule(rule)


@router.patch("/escalation-rules/{rule_id}", response=RuleOut, summary="Изменить правило")
def update_rule(request: HttpRequest, rule_id: str, payload: RulePatch):
    rule = svc.update_rule(rule_id, payload.dict(exclude_unset=True))
    return svc.serialize_rule(rule)


@router.delete("/escalation-rules/{rule_id}", response=OkOut, summary="Удалить правило")
def delete_rule(request: HttpRequest, rule_id: str):
    svc.delete_rule(rule_id)
    return {"ok": True}


# --- Журнал ----------------------------------------------------------------


@router.get("/notification-log", summary="Журнал уведомлений")
def notification_log(
    request: HttpRequest,
    order_id: str | None = None,
    status: str = "",
    search: str = "",
    limit: int | None = None,
    offset: int = 0,
):
    return svc.list_logs(
        order_id=order_id, status=status, search=search, limit=limit, offset=offset
    )
