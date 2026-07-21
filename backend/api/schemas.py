from __future__ import annotations

from datetime import datetime
from typing import Any

from ninja import Schema


class ErrorOut(Schema):
    detail: str
    code: str = "error"


# --- Гостевая сессия -------------------------------------------------------


class GuestSessionIn(Schema):
    room_number: str | None = None
    language: str | None = None


class GuestSessionOut(Schema):
    token: str
    session_id: str
    trust: str
    expires_at: datetime
    hotel: dict[str, Any]
    room: str | None = None


# --- Меню ------------------------------------------------------------------


class MenuOut(Schema):
    language: str | None
    categories: list[dict[str, Any]]


# --- Заказ -----------------------------------------------------------------


class OrderLineIn(Schema):
    item_id: str
    quantity: int = 1
    modifier_option_ids: list[str] = []
    comment: str = ""


class OrderIn(Schema):
    lines: list[OrderLineIn]
    location_id: str | None = None
    location_refinement: str = ""
    delivery_mode: str = "delivery"
    requested_time: datetime | None = None
    comment: str = ""


class OrderOut(Schema):
    id: str
    number: int
    status: dict[str, Any]
    room: str
    location: dict[str, Any] | None
    delivery_mode: str
    requested_time: str | None
    comment: str
    total: int
    currency: str
    created_at: str
    items: list[dict[str, Any]]
