"""
Сервисный слой заказов — самое ответственное место среза.

Что здесь гарантируется:
  * заказ, его позиции и резолв маршрута создаются в ОДНОЙ транзакции;
  * событие order.created эмитится ПОСЛЕ коммита (см. events.bus);
  * цены и названия фиксируются снапшотом;
  * доступность позиции проверяется тем же расчётом, что и выдача меню
    (apps/catalog/availability.py) — иначе гость видел бы блюдо, которое
    нельзя заказать;
  * повтор с тем же ключом идемпотентности не создаёт второй заказ
    (обёртка — в api/guest.py, чтобы кэшировался ровно тот ответ, что уходит
    клиенту).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.catalog.availability import item_availability
from apps.catalog.models import Category, Item, ModifierOption, Route
from apps.catalog.offerings import LocationMode, behaviour_for
from apps.catalog.request_fields import build_field_snapshot
from apps.catalog import slots as slot_svc
from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, DomainError, NotFoundError, ValidationError
from apps.core.fields import translate
from apps.events.bus import (
    ORDER_CANCELLED,
    ORDER_CREATED,
    ORDER_STATUS_CHANGED,
    emit,
)
from apps.hotels.models import ExecutionPoint, Hotel, Location, Room
from apps.media.services import image_url

from .models import Order, OrderItem, OrderStatusChange, StatusDefinition

# Насколько вперёд гость может запланировать заказ. Дальше — уже не «сегодня
# вечером», а планирование, которого витрина не умеет.
MAX_SCHEDULE_AHEAD = timedelta(hours=24)

# Грубая оценка времени выполнения. Настоящая оценка появится вместе с
# трекером и статистикой SLA; сейчас важно, чтобы гость видел не пустоту.
DEFAULT_ETA_MINUTES = {"delivery": 25, "pickup": 15}


class OrderValidationError(ValidationError):
    """Заказ нельзя принять. Конкретную причину несёт code."""

    code = "order_rejected"


class RoutingError(DomainError):
    """Некому исполнять заказ: у категории нет активного маршрута."""

    status = 422
    code = "no_route"


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
    timing: str = "asap"
    requested_time: datetime | None = None
    comment: str = ""
    field_values: dict[str, Any] = field(default_factory=dict)
    slot_start: str | None = None


# --- Создание --------------------------------------------------------------


@transaction.atomic
def create_order(data: OrderInput, *, guest_session=None) -> Order:
    hotel_id = require_hotel_id()
    hotel = _lock_hotel(hotel_id)

    if not data.lines:
        raise OrderValidationError("Заказ пустой", code="empty_order")

    items = [_resolve_item(line) for line in data.lines]
    behaviour = _resolve_behaviour(items)

    if not behaviour.creates_order:
        # info — страница только для чтения: заказывать нечего.
        raise OrderValidationError(
            "Эту позицию нельзя заказать", code="not_orderable"
        )

    if not behaviour.allows_multiple_lines and len(items) > 1:
        raise OrderValidationError(
            "Заявка-услуга оформляется по одной за раз",
            code="single_line_only",
        )

    categories = {item.category_id for item in items}
    if len(categories) > 1:
        # Ограничение осознанное: один заказ — одна точка исполнения. Корзину
        # из разных категорий фронт разбивает на несколько заказов.
        raise OrderValidationError(
            "Позиции из разных категорий нельзя объединить в один заказ",
            code="mixed_categories",
        )

    resolved_lines = [
        {
            "item": item,
            "line": line,
            "selected_options": (
                _validate_modifiers(item, line.modifier_option_ids)
                if behaviour.uses_modifiers
                else _reject_modifiers(line)
            ),
        }
        for item, line in zip(items, data.lines)
    ]
    field_values = _resolve_field_values(behaviour, items, data)

    execution_point = _resolve_execution_point(next(iter(categories)))
    location = _resolve_location(data, items[0])
    room = _resolve_room(data, guest_session)
    requested_time = _validate_requested_time(data, hotel)
    status = _initial_status()

    order = Order.objects.create(
        hotel_id=hotel_id,
        number=_next_number(hotel_id),
        type=behaviour.order_type,
        guest_session=guest_session,
        room=room,
        execution_point=execution_point,
        location=location,
        location_refinement=data.location_refinement[:128],
        delivery_mode=data.delivery_mode,
        requested_time=requested_time,
        comment=data.comment,
        status=status,
        total=None,
        currency=hotel.currency,
        field_values=field_values,
    )

    if behaviour.uses_slots:
        # Транзакционная бронь: защита от двойной брони внутри блокировки
        # SlotConfig. Внутри той же transaction.atomic — откат заказа снимет
        # и бронь.
        slot_svc.validate_and_reserve(items[0], data.slot_start, order=order)

    line_totals = [_create_order_item(order, resolved).line_total for resolved in resolved_lines]
    # Ни у одной позиции нет цены → у заказа нет суммы. Ноль означал бы
    # «бесплатно», а это другое утверждение.
    priced = [total for total in line_totals if total is not None]
    order.total = sum(priced) if priced else None
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


def _resolve_item(line: OrderLineInput) -> Item:
    """Позиция существует, доступна и запрошена в разумном количестве."""
    item = (
        Item.objects.select_related("category", "schedule", "category__schedule")
        .prefetch_related("modifier_groups__options", "request_fields")
        .filter(pk=line.item_id)
        .first()
    )
    if item is None:
        raise OrderValidationError(f"Позиция {line.item_id} не найдена", code="item_not_found")

    state = item_availability(item)
    if not state.is_available:
        message = f"«{item.title_i18n}» сейчас недоступна"
        if state.available_from:
            message += f" — доступна с {state.available_from}"
        raise OrderValidationError(message, code="item_unavailable", field="lines")

    if line.quantity < 1:
        raise OrderValidationError("Количество должно быть положительным", code="bad_quantity")
    return item


def _resolve_behaviour(items: list[Item]):
    """
    Поведение заказа определяет тип позиций — и он обязан быть одинаковым.

    Смешать в одном заказе блюдо и заявку на такси нельзя: у них разные
    правила наполнения, разные исполнители и разный смысл суммы.
    """
    types = {item.type for item in items}
    if len(types) > 1:
        raise OrderValidationError(
            "В одном заказе нельзя смешивать товары и заявки-услуги",
            code="mixed_offering_types",
        )
    return behaviour_for(next(iter(types)))


def _reject_modifiers(line: OrderLineInput) -> list[ModifierOption]:
    """У типа без модификаторов их присылать нечем и незачем."""
    if line.modifier_option_ids:
        raise OrderValidationError(
            "У этой услуги нет модификаторов",
            code="modifiers_not_supported",
            field="modifier_option_ids",
        )
    return []


def _resolve_field_values(behaviour, items: list[Item], data: OrderInput) -> list[dict]:
    """Ответы на поля заявки — снимком; у товаров их быть не должно."""
    if not behaviour.uses_fields:
        if data.field_values:
            raise OrderValidationError(
                "У этой позиции нет полей заявки",
                code="fields_not_supported",
                field="field_values",
            )
        return []

    fields = list(items[0].request_fields.all())
    return build_field_snapshot(fields, data.field_values, language=None)


def _validate_modifiers(item: Item, option_ids: list[str]) -> list[ModifierOption]:
    """
    Проверяет обязательность групп и ограничения single/multi.

    Валидация именно здесь, а не на фронте: цена заказа считается по серверным
    данным, значит и набор модификаторов должен проверять сервер.
    """
    requested = {str(pk) for pk in option_ids}
    selected: list[ModifierOption] = []

    for group in item.modifier_groups.all():
        options = [option for option in group.options.all() if option.is_active]
        chosen = [option for option in options if str(option.pk) in requested]
        requested -= {str(option.pk) for option in chosen}

        if group.is_required and not chosen:
            raise OrderValidationError(
                f"Не выбран обязательный модификатор «{group.title_i18n}»",
                code="modifier_required",
                field="modifier_option_ids",
            )
        if group.selection == group.Selection.SINGLE and len(chosen) > 1:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» можно выбрать только один вариант",
                code="modifier_single",
            )
        if group.max_choices and len(chosen) > group.max_choices:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» слишком много вариантов",
                code="modifier_too_many",
            )
        if len(chosen) < group.min_choices:
            raise OrderValidationError(
                f"В группе «{group.title_i18n}» нужно выбрать минимум {group.min_choices}",
                code="modifier_too_few",
            )
        selected.extend(chosen)

    if requested:
        raise OrderValidationError(
            "Переданы модификаторы, не относящиеся к позиции", code="modifier_unknown"
        )
    return selected


def _create_order_item(order: Order, resolved: dict[str, Any]) -> OrderItem:
    item: Item = resolved["item"]
    line: OrderLineInput = resolved["line"]
    options: list[ModifierOption] = resolved["selected_options"]

    # У позиции без цены сумма строки тоже отсутствует — не ноль.
    unit_price = (
        None if item.price is None else item.price + sum(option.price_delta for option in options)
    )
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
        line_total=None if unit_price is None else unit_price * line.quantity,
        comment=line.comment[:255],
    )


def _resolve_execution_point(category_id) -> ExecutionPoint:
    """
    Кто будет исполнять. Резолвится один раз при создании заказа и дальше не
    пересчитывается — перенастройка маршрутов не должна переносить вчерашние
    заказы на другую кухню.

    Порядок с фолбэками, потому что категория, только что созданная в CMS,
    маршрута ещё не имеет, а заказать её гость уже может. Молча ронять заказ
    из-за ненастроенной админки — худший вариант из возможных.
    """
    route = (
        Route.objects.select_related("execution_point")
        .filter(category_id=category_id, is_active=True, execution_point__is_active=True)
        .order_by("priority")
        .first()
    )
    if route is not None:
        return route.execution_point

    category = Category.objects.filter(pk=category_id).first()

    # 2. Соглашение «категория = точка»: категория «bar» уходит на точку «bar».
    if category is not None:
        by_code = ExecutionPoint.objects.filter(code=category.code, is_active=True).first()
        if by_code is not None:
            return by_code

    # 3. Один исполнитель на отель — выбирать не из чего.
    points = list(ExecutionPoint.objects.filter(is_active=True)[:2])
    if len(points) == 1:
        return points[0]

    raise RoutingError(
        f"Для категории «{category.code if category else category_id}» "
        "не настроен маршрут на точку исполнения"
    )


def _resolve_location(data: OrderInput, item: Item) -> Location | None:
    """
    Спрашивать локацию имеет смысл не всегда: у такси точка подачи — поле
    заявки, у уборки номер и так известен. Решает режим позиции, а не тип.
    """
    if item.location_mode != LocationMode.DELIVERY:
        if data.location_id:
            raise OrderValidationError(
                "Для этой услуги локация не указывается",
                code="location_not_supported",
                field="location_id",
            )
        return None

    if not data.location_id:
        return None
    location = Location.objects.filter(pk=data.location_id, is_active=True).first()
    if location is None:
        raise OrderValidationError("Локация не найдена", code="location_not_found", field="location_id")
    if location.requires_refinement and not data.location_refinement.strip():
        raise OrderValidationError(
            f"Для локации «{location.title_i18n}» нужно уточнение "
            f"({location.refinement_label_i18n or 'место'})",
            code="refinement_required",
            field="location_refinement",
        )
    return location


def _resolve_room(data: OrderInput, guest_session) -> Room | None:
    if data.room_id:
        room = Room.objects.filter(pk=data.room_id, is_active=True).first()
        if room is None:
            raise OrderValidationError("Номер не найден", code="room_not_found")
        return room
    return getattr(guest_session, "room", None)


def _validate_requested_time(data: OrderInput, hotel: Hotel) -> datetime | None:
    """«Как можно скорее» — это отсутствие времени, а не now(): now() устарел бы
    к моменту, когда заказ дойдёт до кухни."""
    if data.timing != "scheduled":
        return None
    if data.requested_time is None:
        raise OrderValidationError(
            "Укажите время", code="requested_time_invalid", field="requested_time"
        )

    moment = data.requested_time
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, hotel.tzinfo)

    now = timezone.now()
    if moment < now - timedelta(minutes=1):
        raise OrderValidationError(
            "Время уже прошло", code="requested_time_invalid", field="requested_time"
        )
    if moment > now + MAX_SCHEDULE_AHEAD:
        raise OrderValidationError(
            "Заказ можно запланировать не более чем на сутки вперёд",
            code="requested_time_invalid",
            field="requested_time",
        )
    return moment


def _initial_status() -> StatusDefinition:
    status = StatusDefinition.objects.filter(is_initial=True).order_by("sort_order").first()
    if status is None:
        raise OrderValidationError(
            "Для отеля не настроен начальный статус заказа (нужен пресет статусов)",
            code="status_preset_missing",
        )
    return status


def _lock_hotel(hotel_id) -> Hotel:
    # Блокировка строки отеля сериализует выдачу номеров заказов. Отдельная
    # sequence не подошла бы: номер должен быть сквозным в рамках отеля.
    return Hotel.objects.select_for_update().get(pk=hotel_id)


def _next_number(hotel_id) -> int:
    current = Order.all_objects.filter(hotel_id=hotel_id).aggregate(Max("number"))["number__max"]
    return (current or 0) + 1


# --- Чтение ----------------------------------------------------------------


def order_queryset():
    return Order.objects.select_related(
        "status", "room", "location", "execution_point"
    ).prefetch_related("items__item__images__asset", "status_changes__to_status")


def get_order(order_id, *, guest_session=None) -> Order:
    queryset = order_queryset()
    if guest_session is not None:
        queryset = queryset.filter(guest_session_id=guest_session.pk)
    order = queryset.filter(pk=order_id).first()
    if order is None:
        raise NotFoundError("Заказ не найден")
    return order


def list_guest_orders(guest_session, language: str | None = None) -> dict[str, list[dict]]:
    """
    Разделение на активные и прошлые делает сервер: клиенту не нужно знать
    пресет статусов отеля, чтобы правильно разложить список.
    """
    orders = order_queryset().filter(guest_session_id=guest_session.pk).order_by("-created_at")
    active, past = [], []
    for order in orders:
        (past if order.status.is_terminal else active).append(serialize_order(order, language))
    return {"active": active, "past": past}


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
        raise OrderValidationError(f"Статус '{to_code}' не настроен", code="unknown_status")

    order = Order.objects.select_for_update().select_related("status").get(pk=order.pk)
    if order.status_id == target.pk:
        return get_order(order.pk)
    if order.status.is_terminal:
        raise ConflictError(
            f"Заказ уже в терминальном статусе «{order.status.code}»",
            code="order_finished",
        )

    previous = order.status
    order.status = target
    order.save(update_fields=["status", "updated_at"])

    if target.is_cancelled:
        # Отмена брони освобождает слот — одинаково для отмены гостем и
        # персоналом, потому что живёт в общей смене статуса.
        slot_svc.release_bookings(order)

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
    return get_order(order.pk)


def cancel_order_by_guest(order: Order, *, guest_session, reason: str = "") -> Order:
    """
    Отмена гостем разрешена ровно в тех статусах, где отель её разрешил
    (`allows_guest_cancel`). Проверка на сервере, даже если кнопки в UI нет:
    между отрисовкой экрана и нажатием кухня успевает взять заказ в работу.
    """
    if not order.status.allows_guest_cancel:
        raise ConflictError(
            f"Заказ в статусе «{order.status.title_i18n}» уже нельзя отменить",
            code="cancel_not_allowed",
        )

    cancelled = StatusDefinition.objects.filter(is_cancelled=True).order_by("sort_order").first()
    if cancelled is None:
        raise OrderValidationError(
            "В пресете статусов отеля нет статуса отмены", code="status_preset_missing"
        )

    return change_status(
        order,
        to_code=cancelled.code,
        actor_type="guest",
        actor_id=guest_session.pk if guest_session else None,
        comment=reason,
    )


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


def _eta_minutes(order: Order) -> int | None:
    """
    Грубая оценка: настоящая приедет вместе с трекером и статистикой SLA.
    Для заказа ко времени показываем, сколько осталось до него, — это честнее,
    чем средняя длительность приготовления.
    """
    if order.status.is_terminal:
        return None
    if order.requested_time:
        minutes = int((order.requested_time - timezone.now()).total_seconds() // 60)
        return max(minutes, 0)
    return DEFAULT_ETA_MINUTES.get(order.delivery_mode, 25)


def _status_payload(status: StatusDefinition, language: str | None) -> dict[str, Any]:
    return {
        "code": status.code,
        "title": translate(status.title, language),
        "sort_order": status.sort_order,
        "is_terminal": status.is_terminal,
        "is_cancelled": status.is_cancelled,
        "color_token": status.color_token,
        "allows_guest_cancel": status.allows_guest_cancel,
    }


def _item_image(order_item: OrderItem) -> str:
    item = order_item.item
    link = next(iter(item.images.all()), None) if item else None
    return image_url(link.asset if link else None, variant="thumb")


def _can_review(order: Order) -> bool:
    from apps.reviews.services import can_review

    return can_review(order)


def _order_review(order: Order) -> dict | None:
    from apps.reviews.services import get_review

    return get_review(order)


def serialize_order(order: Order, language: str | None = None) -> dict[str, Any]:
    """
    Один и тот же вид у REST и у WebSocket — чтобы клиент не собирал состояние
    из двух разных форматов. Пресет статусов и история едут вместе с заказом:
    таймлайн рисуется без второго запроса и без знания пресета на клиенте.
    """
    hotel = order.hotel
    flow = StatusDefinition.objects.filter(hotel_id=order.hotel_id).order_by("sort_order")

    return {
        "id": str(order.pk),
        "number": order.number,
        "type": order.type,
        "created_at": hotel.to_local(order.created_at).isoformat(),
        "status": _status_payload(order.status, language),
        "status_flow": [
            {
                "code": status.code,
                "title": translate(status.title, language),
                "sort_order": status.sort_order,
                "is_cancelled": status.is_cancelled,
            }
            for status in flow
        ],
        "history": [
            {
                "code": change.to_status.code,
                "title": translate(change.to_status.title, language),
                "at": hotel.to_local(change.created_at).isoformat(),
            }
            for change in order.status_changes.all()
        ],
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
            hotel.to_local(order.requested_time).isoformat() if order.requested_time else None
        ),
        "eta_minutes": _eta_minutes(order),
        "comment": order.comment,
        "total": order.total,
        "currency": order.currency,
        # Непусто только у заявки-услуги. Трекер и витрина рисуют этим блоком
        # тело карточки вместо списка позиций — но объект заказа один.
        "field_values": [
            {
                "code": entry.get("code", ""),
                "label": translate(entry.get("label"), language),
                "field_type": entry.get("field_type", "text"),
                "value": entry.get("value"),
                "display": entry.get("display", ""),
            }
            for entry in (order.field_values or [])
        ],
        # Непусто только у брони: трекер и витрина рисуют этим блоком тело
        # карточки вместо позиций — та же развилка «по данным», что и выше.
        "slot": slot_svc.serialize_slot(order, language),
        "can_review": _can_review(order),
        "review": _order_review(order),
        "items": [
            {
                "id": str(line.pk),
                "item_id": str(line.item_id),
                "title": translate(line.title_snapshot, language),
                "quantity": line.quantity,
                "unit_price": line.unit_price_snapshot,
                "line_total": line.line_total,
                "comment": line.comment,
                "image_url": _item_image(line),
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
