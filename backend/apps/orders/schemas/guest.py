"""
Схемы заказа, которые собирает гость.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ninja import Schema



class OrderLineIn(Schema):
    item_id: str
    quantity: int = 1
    modifier_option_ids: list[str] = []
    comment: str = ""

class OrderIn(Schema):
    lines: list[OrderLineIn]
    # Код сервиса-корзины (заведения). Задан → позиции резолвятся по включениям
    # сервиса, заказ-агрегатор разъезжается по исполнителям. Не задан → прежнее
    # поведение (один исполнитель из маршрута категории).
    service_code: str | None = None
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
    # Вид гостевой карточки: booking | delivery | ride | request. Считается из
    # того же реестра, что и тип трекера (apps/orders/tracker_types.py).
    card_kind: str = "request"
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
