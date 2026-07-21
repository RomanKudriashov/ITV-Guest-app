"""
Сервисный слой заказов — самое ответственное место фундамента.

Что здесь гарантируется:
  * заказ, его позиции и резолв маршрута создаются в ОДНОЙ транзакции;
  * событие order.created эмитится ПОСЛЕ коммита (см. events.bus);
  * цены и названия фиксируются снапшотом;
  * повтор с тем же ключом идемпотентности не создаёт второй заказ
    (обёртка — в api/guest.py, чтобы кэшировался ровно тот ответ, что уходит
    клиенту).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from django.db import transaction
from django.db.models import Max

from apps.catalog.models import Category, Item, ModifierOption, Route
from apps.core.context import require_hotel_id
from apps.core.fields import translate
from apps.events.bus import (
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    emit,
)
from apps.hotels.models import ExecutionPoint, Location, Room

from .models import Order, OrderItem, OrderStatusChange, StatusDefinition


class OrderValidationError(Exception):
    """Заказ нельзя принять. Отдаётся гостю как 400 с внятным текстом."""


class RoutingError(Exception):
    """Некому исполнять заказ: у категории нет активного маршрута."""


@dataclass(slots=True)
class OrderLineInput:
    item_id: str
    quantity: int = 1
    modifier_option_ids: list[str] = field(default_factory=list)
    comment: str = ""


@dataclass(slots=True)
class OrderInput:
    lines: list[OrderLineInput]
    room_id: str | None = None
    location_id: str | None = None
    location_refinement: str = ""
    delivery_mode: str = Order.DeliveryMode.DELIVERY
    requested_time: datetime | None = None
    comment: str = ""


# --- Создание --------------------------------------------------------------


@transaction.atomic
def create_order(data: OrderInput, *, guest_session=None) -> Order:
    hotel_id = require_hotel_id()

    if not data.lines:
        raise OrderValidationError("Заказ пустой")

    resolved_lines = [_resolve_line(line) for line in data.lines]
    categories = {rl["item"].category_id for rl in resolved_lines}
    if len(categories) > 1:
        # Ограничение осознанное: один заказ — одна точка исполнения. Корзину
        # из разных категорий фронт разбивает на несколько заказов.
        raise OrderValidationError(
            "Позиции из разных категорий нельзя объединить в один заказ"
        )

    category_id = next(iter(categories))
    execution_point = _resolve_execution_point(category_id)
    location = _resolve_location(data)
    room = _resolve_room(data, guest_session)
    status = _initial_status()

    hotel = _lock_hotel(hotel_id)
    order = Order.objects.create(
        hotel_id=hotel_id,
        number=_next_number(hotel_id),
        type=Order.Type.CART,
        guest_session=guest_session,
        room=room,
        execution_point=execution_point,
        location=location,
        location_refinement=data.location_refinement[:128],
        delivery_mode=data.delivery_mode,
        requested_time=data.requested_time,
        comment=data.comment,
        status=status,
        total=0,
        currency=hotel.currency,
    )

    total = 0
    for resolved in resolved_lines:
        order_item = _create_order_item(order, resolved)
        total += order_item.line_total

    order.total = total
    order.save(update_fields=["total", "updated_at"])

    OrderStatusChange.objects.create(
        hotel_id=hotel_id,
        order=order,
        from_status=None,
        to_status=status,
        actor_type="guest" if guest_session else "system",
        actor_id=guest_session.pk if guest_session else None,
    )

    emit(
        ORDER_CREATED,
        _event_payload(order),
        hotel_id=hotel_id,
        actor_type="guest" if guest_session else "system",
        actor_id=guest_session.pk if guest_session else None,
    )
    return order


def _resolve_line(line: OrderLineInput) -> dict[str, Any]:
    item = (
        Item.objects.select_related("category", "schedule")
        .prefetch_related("modifier_groups__options")
        .filter(pk=line.item_id)
        .first()
    )
    if item is None:
        raise OrderValidationError(f"Позиция {line.item_id} не найдена")
    if not item.is_available_at():
        raise OrderValidationError(f"Позиция «{item.title_i18n}» сейчас недоступна")
    if line.quantity < 1:
        raise OrderValidationError("Количество должно быть положительным")

    selected = _validate_modifiers(item, line.modifier_option_ids)
    return {"item": item, "line": line, "selected_options": selected}


def _validate_modifiers(item: Item, option_ids: list[str]) -> list[ModifierOption]:
    """
    Проверяет обязательность групп и ограничения single/multi.

    Валидация именно здесь, а не на фронте: цена заказа считается по серверным
    данным, значит и набор модификаторов должен проверять сервер.
    """
    requested = set(str(pk) for pk in option_ids)
    selected: list[ModifierOption] = []

    for group in item.modifier_groups.all():
        options = [o for o in group.options.all() if o.is_active]
        chosen = [o for o in options if str(o.pk) in requested]
        requested -= {str(o.pk) for o in chosen}

        if group.is_required and not chosen:
            raise OrderValidationError(
                f"Не выбран обязательный модификатор «{group.title_i18n}»"
            )
        if group.selection == group.Selection.SINGLE and len(chosen) > 1:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» можно выбрать только один вариант"
            )
        if group.max_choices and len(chosen) > group.max_choices:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» слишком много вариантов"
            )
        if len(chosen) < group.min_choices:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» нужно выбрать минимум {group.min_choices}"
            )
        selected.extend(chosen)

    if requested:
        raise OrderValidationError("Переданы модификаторы, не относящиеся к позиции")
    return selected


def _create_order_item(order: Order, resolved: dict[str, Any]) -> OrderItem:
    item: Item = resolved["item"]
    line: OrderLineInput = resolved["line"]
    options: list[ModifierOption] = resolved["selected_options"]

    unit_price = item.price + sum(option.price_delta for option in options)
    return OrderItem.objects.create(
        hotel_id=order.hotel_id,
        order=order,
        item=item,
        quantity=line.quantity,
        title_snapshot=dict(item.title or {}),
        unit_price_snapshot=unit_price,
        modifiers_snapshot=[
            {
                "group_code": option.group.code,
                "option_id": str(option.pk),
                "code": option.code,
                "title": dict(option.title or {}),
                "price_delta": option.price_delta,
            }
            for option in options
        ],
        line_total=unit_price * line.quantity,
        comment=line.comment[:255],
    )


def _resolve_execution_point(category_id) -> ExecutionPoint:
    route = (
        Route.objects.select_related("execution_point")
        .filter(category_id=category_id, is_active=True, execution_point__is_active=True)
        .order_by("priority")
        .first()
    )
    if route is None:
        category = Category.objects.filter(pk=category_id).first()
        raise RoutingError(
            f"Для категории «{category.code if category else category_id}» "
            "не настроен маршрут на точку исполнения"
        )
    return route.execution_point


def _resolve_location(data: OrderInput) -> Location | None:
    if not data.location_id:
        return None
    location = Location.objects.filter(pk=data.location_id, is_active=True).first()
    if location is None:
        raise OrderValidationError("Локация не найдена")
    if location.requires_refinement and not data.location_refinement.strip():
        raise OrderValidationError(
            f"Для локации «{location.title_i18n}» нужно уточнение "
            f"({location.refinement_label_i18n or 'место'})"
        )
    return location


def _resolve_room(data: OrderInput, guest_session) -> Room | None:
    if data.room_id:
        room = Room.objects.filter(pk=data.room_id, is_active=True).first()
        if room is None:
            raise OrderValidationError("Номер не найден")
        return room
    return getattr(guest_session, "room", None)


def _initial_status() -> StatusDefinition:
    status = StatusDefinition.objects.filter(is_initial=True).order_by("sort_order").first()
    if status is None:
        raise OrderValidationError(
            "Для отеля не настроен начальный статус заказа (нужен пресет статусов)"
        )
    return status


def _lock_hotel(hotel_id):
    from apps.hotels.models import Hotel

    # Блокировка строки отеля сериализует выдачу номеров заказов. Отдельная
    # sequence не подошла бы: номер должен быть сквозным в рамках отеля.
    return Hotel.objects.select_for_update().get(pk=hotel_id)


def _next_number(hotel_id) -> int:
    current = Order.all_objects.filter(hotel_id=hotel_id).aggregate(Max("number"))[
        "number__max"
    ]
    return (current or 0) + 1


# --- Смена статуса ---------------------------------------------------------


@transaction.atomic
def change_status(
    order: Order,
    *,
    to_code: str,
    actor_type: str = "staff",
    actor_id=None,
    comment: str = "",
) -> Order:
    target = StatusDefinition.objects.filter(code=to_code).first()
    if target is None:
        raise OrderValidationError(f"Статус '{to_code}' не настроен")

    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.status_id == target.pk:
        return order
    if order.status.is_terminal:
        raise OrderValidationError(
            f"Заказ уже в терминальном статусе «{order.status.code}»"
        )

    previous = order.status
    order.status = target
    order.save(update_fields=["status", "updated_at"])

    OrderStatusChange.objects.create(
        hotel_id=order.hotel_id,
        order=order,
        from_status=previous,
        to_status=target,
        actor_type=actor_type,
        actor_id=actor_id,
        comment=comment[:255],
    )

    payload = _event_payload(order)
    payload["from_status"] = previous.code
    payload["to_status"] = target.code
    emit(
        ORDER_CANCELLED if target.is_cancelled else ORDER_STATUS_CHANGED,
        payload,
        hotel_id=order.hotel_id,
        actor_type=actor_type,
        actor_id=actor_id,
    )
    return order


# --- Сериализация ----------------------------------------------------------


def _event_payload(order: Order) -> dict[str, Any]:
    return {
        "order_id": str(order.pk),
        "number": order.number,
        "hotel_id": str(order.hotel_id),
        "execution_point_id": str(order.execution_point_id),
        "room": order.room.number if order.room_id else "",
        "status": order.status.code,
        "total": order.total,
        "currency": order.currency,
        "delivery_mode": order.delivery_mode,
    }


def serialize_order(order: Order, language: str | None = None) -> dict[str, Any]:
    return {
        "id": str(order.pk),
        "number": order.number,
        "status": {
            "code": order.status.code,
            "title": translate(order.status.title, language),
            "is_terminal": order.status.is_terminal,
            "is_cancelled": order.status.is_cancelled,
        },
        "room": order.room.number if order.room_id else "",
        "location": (
            {
                "code": order.location.code,
                "title": translate(order.location.title, language),
                "refinement": order.location_refinement,
            }
            if order.location_id
            else None
        ),
        "delivery_mode": order.delivery_mode,
        "requested_time": (
            order.requested_time.isoformat() if order.requested_time else None
        ),
        "comment": order.comment,
        "total": order.total,
        "currency": order.currency,
        "created_at": order.created_at.isoformat(),
        "items": [
            {
                "id": str(line.pk),
                "item_id": str(line.item_id),
                "title": translate(line.title_snapshot, language),
                "quantity": line.quantity,
                "unit_price": line.unit_price_snapshot,
                "line_total": line.line_total,
                "comment": line.comment,
                "modifiers": [
                    {
                        "code": modifier.get("code", ""),
                        "title": translate(modifier.get("title"), language),
                        "price_delta": modifier.get("price_delta", 0),
                    }
                    for modifier in (line.modifiers_snapshot or [])
                ],
            }
            for line in order.items.all()
        ],
    }
