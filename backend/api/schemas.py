"""Схемы гостевой витрины. Контракт — docs/guest-api-contract.md."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ninja import Schema


class ErrorOut(Schema):
    detail: str
    code: str = "error"
    field: str | None = None


# --- Сессия ----------------------------------------------------------------


class GuestSessionIn(Schema):
    room_number: str | None = None
    language: str | None = None


class HotelOut(Schema):
    id: str
    name: str
    subdomain: str
    currency: str
    currency_minor_units: int
    timezone: str
    default_language: str
    languages: list[dict[str, Any]]
    theme: dict[str, Any]


class GuestSessionOut(Schema):
    token: str | None = None
    session_id: str
    trust: str
    expires_at: datetime
    language: str
    room: str | None = None
    hotel: HotelOut


class RoomNotFoundOut(Schema):
    """Не ошибка сервера, а развилка сценария: ведём гостя на ручной ввод."""

    detail: str
    code: str = "room_not_found"
    hint: str = "manual_entry"
    hotel: HotelOut


# --- Меню ------------------------------------------------------------------


class MenuOut(Schema):
    language: str | None
    server_time: str | None
    categories: list[dict[str, Any]]


class ItemDetailOut(Schema):
    id: str
    code: str
    type: str
    location_mode: str
    category_id: str
    category_title: str
    title: str
    description: str
    price: int | None
    images: list[str]
    flags: list[str]
    allergens: list[str]
    has_modifiers: bool
    has_required_modifiers: bool
    has_fields: bool
    has_content: bool = False
    has_slots: bool = False
    is_orderable: bool = True
    content: str = ""
    is_available: bool
    unavailable_reason: str | None
    available_from: str | None
    available_until: str | None
    modifier_groups: list[dict[str, Any]]
    request_fields: list[dict[str, Any]]


# --- Локации ---------------------------------------------------------------


class LocationsOut(Schema):
    room: str | None
    locations: list[dict[str, Any]]
    delivery_modes: list[str]


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
    timing: str = "asap"
    requested_time: datetime | None = None
    comment: str = ""
    # Ответы на поля заявки-услуги: {code поля: значение}. У товаров пусто.
    field_values: dict[str, Any] = {}
    # Выбранное время слота (тип slot), ISO 8601.
    slot_start: str | None = None
    # Чаевые: своя сумма ИЛИ процент от суммы позиций.
    tip_minor: int | None = None
    tip_percent: float | None = None


class CancelIn(Schema):
    reason: str = ""


class OrderOut(Schema):
    id: str
    number: int
    type: str
    created_at: str
    status: dict[str, Any]
    status_flow: list[dict[str, Any]]
    history: list[dict[str, Any]]
    room: str
    location: dict[str, Any] | None
    delivery_mode: str
    requested_time: str | None
    eta_minutes: int | None
    comment: str
    total: int | None
    currency: str
    # Снимок начислений и ожидаемое время подачи.
    charges: dict[str, Any] = {}
    serve_by: str | None = None
    field_values: list[dict[str, Any]]
    slot: dict[str, Any] | None = None
    can_review: bool = False
    review: dict[str, Any] | None = None
    items: list[dict[str, Any]]


class OrdersOut(Schema):
    active: list[OrderOut]
    past: list[OrderOut]


# --- Смена статуса (персонал) ----------------------------------------------


class StatusChangeIn(Schema):
    status: str
    comment: str = ""
