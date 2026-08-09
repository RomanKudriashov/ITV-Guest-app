"""
Схемы уведомлений — CMS.

Объявлялись прямо во вьюхе; имена не менялись, поэтому компоненты OpenAPI
остались прежними.
"""

from __future__ import annotations

from typing import Any

from ninja import Schema


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
