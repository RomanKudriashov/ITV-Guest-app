"""
CMS: каналы уведомлений, правила эскалации, журнал.
Контракт — docs/notifications-api-contract.md.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest
from ninja import Router, Schema

from apps.notifications import cms_services as svc
from apps.notifications.services import send_test_message

from .schemas import OkOut

router = Router(tags=["cms:notifications"])


# --- Схемы -----------------------------------------------------------------


class ChannelIn(Schema):
    type: str = "log"
    title: str
    is_active: bool = True
    execution_point_id: str | None = None
    user_id: str | None = None
    config: dict[str, Any] = {}
    templates: dict[str, Any] = {}


class ChannelPatch(Schema):
    type: str | None = None
    title: str | None = None
    is_active: bool | None = None
    execution_point_id: str | None = None
    user_id: str | None = None
    config: dict[str, Any] | None = None
    templates: dict[str, Any] | None = None


class ChannelOut(Schema):
    id: str
    type: str
    title: str
    is_active: bool
    execution_point_id: str | None
    user_id: str | None
    config_public: dict[str, Any]
    templates: dict[str, Any]


class TestOut(Schema):
    ok: bool
    detail: str


class StepIn(Schema):
    delay_minutes: int = 0
    target_kind: str = "point"
    channel_id: str | None = None
    title: str = ""


class RuleIn(Schema):
    name: str
    execution_point_id: str | None = None
    is_active: bool = True
    steps: list[StepIn] = []


class RulePatch(Schema):
    name: str | None = None
    execution_point_id: str | None = None
    is_active: bool | None = None
    steps: list[StepIn] | None = None


class RuleOut(Schema):
    id: str
    name: str
    execution_point_id: str | None
    is_active: bool
    steps: list[dict[str, Any]]


class LogOut(Schema):
    id: str
    order_id: str
    order_number: int
    rule_id: str | None
    step_id: str | None
    step_index: int
    parent_id: str | None
    channel_id: str | None
    channel_type: str
    channel_title: str
    target_kind: str
    status: str
    scheduled_for: str | None
    sent_at: str | None
    created_at: str
    attempts: int
    error: str
    subject: str
    body: str
    accepted_at_send: bool


# --- Каналы ----------------------------------------------------------------


@router.get("/notification-channels", response=list[ChannelOut], summary="Каналы уведомлений")
def list_channels(request: HttpRequest):
    return svc.list_channels()


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


@router.get("/escalation-rules", response=list[RuleOut], summary="Правила эскалации")
def list_rules(request: HttpRequest):
    return svc.list_rules()


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


@router.get("/notification-log", response=list[LogOut], summary="Журнал уведомлений")
def notification_log(
    request: HttpRequest,
    order_id: str | None = None,
    status: str = "",
    limit: int = 100,
):
    return svc.list_logs(order_id=order_id, status=status, limit=limit)
