"""
Сервисный слой админки отеля: номера, локации, отделы.

Логика в сервисах, вьюхи тонкие. Тенант нигде не фильтруется руками —
менеджеры скоупят, RLS страхует.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction

from apps.catalog.models import Category, ServiceLocation
from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.core.fields import translate
from apps.media.models import MediaAsset
from apps.media.services import serialize_asset

from .models import ExecutionPoint, Hotel, Location, Room, Schedule

MAX_BULK_RANGE = 500


# --- Номера ----------------------------------------------------------------


def serialize_room(room: Room, *, hotel: Hotel | None = None) -> dict:
    hotel = hotel or room.hotel
    return {
        "id": str(room.pk),
        "number": room.number,
        "floor": room.floor,
        "zone": room.zone,
        "source": room.source,
        "is_active": room.is_active,
        "guest_url": hotel.room_deeplink(room.number),
    }


def list_rooms() -> list[dict]:
    hotel = Hotel.objects.get(pk=require_hotel_id())
    rooms = Room.objects.order_by("number")
    return [serialize_room(room, hotel=hotel) for room in rooms]


def get_room(room_id) -> Room:
    room = Room.objects.filter(pk=room_id).first()
    if room is None:
        raise NotFoundError("Номер не найден")
    return room


@transaction.atomic
def create_room(data: dict) -> Room:
    number = str(data.get("number") or "").strip()
    if not number:
        raise ValidationError("Укажите номер", field="number")
    if Room.all_objects.filter(number=number).exists():
        raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")

    return Room.objects.create(
        number=number,
        floor=str(data.get("floor") or "").strip(),
        zone=str(data.get("zone") or "").strip(),
        is_active=data.get("is_active", True),
    )


@transaction.atomic
def update_room(room_id, data: dict) -> Room:
    room = get_room(room_id)
    if "number" in data:
        number = str(data["number"] or "").strip()
        if not number:
            raise ValidationError("Укажите номер", field="number")
        if Room.all_objects.filter(number=number).exclude(pk=room.pk).exists():
            raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")
        room.number = number
    if "floor" in data:
        room.floor = str(data["floor"] or "").strip()
    if "zone" in data:
        room.zone = str(data["zone"] or "").strip()
    if "is_active" in data:
        room.is_active = data["is_active"]
    room.save()
    return room


def delete_room(room_id) -> None:
    get_room(room_id).delete()


@transaction.atomic
def bulk_create_rooms(data: dict) -> dict:
    """
    Диапазон номеров одним действием. Уже существующие пропускаются молча —
    повторный вызов не падает и не двоит: заводить отель по частям это норма.
    """
    try:
        start = int(data["from"])
        end = int(data["to"])
    except (KeyError, TypeError, ValueError):
        raise ValidationError("Границы диапазона должны быть числами", field="from") from None

    if start > end:
        raise ValidationError("Начало диапазона больше конца", field="from", code="bad_range")
    if end - start + 1 > MAX_BULK_RANGE:
        raise ValidationError(
            f"За один раз не больше {MAX_BULK_RANGE} номеров",
            field="to",
            code="range_too_large",
        )

    prefix = str(data.get("prefix") or "")
    suffix = str(data.get("suffix") or "")
    floor = str(data.get("floor") or "").strip()
    zone = str(data.get("zone") or "").strip()

    existing = set(Room.all_objects.values_list("number", flat=True))
    created, skipped = [], []
    to_create = []
    for value in range(start, end + 1):
        number = f"{prefix}{value}{suffix}"
        if number in existing:
            skipped.append(number)
            continue
        to_create.append(
            Room(hotel_id=require_hotel_id(), number=number, floor=floor, zone=zone)
        )
        created.append(number)

    Room.objects.bulk_create(to_create)
    return {"created": created, "skipped": skipped}


def room_qr_targets() -> tuple[Hotel, list[Room]]:
    hotel = Hotel.objects.get(pk=require_hotel_id())
    return hotel, list(Room.objects.filter(is_active=True).order_by("number"))


# --- Локации ---------------------------------------------------------------


def serialize_location(location: Location) -> dict:
    return {
        "id": str(location.pk),
        "code": location.code,
        "kind": location.kind,
        "title": location.title or {},
        "requires_refinement": location.requires_refinement,
        "refinement_label": location.refinement_label or {},
        "schedule_id": str(location.schedule_id) if location.schedule_id else None,
        "sort_order": location.sort_order,
        "is_active": location.is_active,
        "delivery_fee_minor": location.delivery_fee_minor,
    }


def list_locations() -> list[dict]:
    return [serialize_location(loc) for loc in Location.objects.order_by("sort_order", "code")]


def get_location(location_id) -> Location:
    location = Location.objects.filter(pk=location_id).first()
    if location is None:
        raise NotFoundError("Локация не найдена")
    return location


def _clean_translations(value: Any, *, field: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("Ожидается объект {язык: значение}", field=field)
    return {str(k): str(v).strip() for k, v in value.items() if v and str(v).strip()}


def _make_location_code(title: dict) -> str:
    from apps.catalog.cms_services import make_code

    return make_code(Location, title, prefix="location")


def _resolve_schedule(schedule_id) -> Schedule | None:
    if not schedule_id:
        return None
    schedule = Schedule.objects.filter(pk=schedule_id).first()
    if schedule is None:
        raise ValidationError("Расписание не найдено", field="schedule_id")
    return schedule


def _validate_refinement(requires: bool, label: dict) -> None:
    if requires and not label:
        raise ValidationError(
            "Локация с уточнением требует подписи поля",
            field="refinement_label",
            code="refinement_label_required",
        )


@transaction.atomic
def create_location(data: dict) -> Location:
    title = _clean_translations(data.get("title"), field="title")
    if not title:
        raise ValidationError("Заполните название локации", field="title")
    requires = data.get("requires_refinement", False)
    label = _clean_translations(data.get("refinement_label"), field="refinement_label")
    _validate_refinement(requires, label)

    return Location.objects.create(
        code=data.get("code") or _make_location_code(title),
        kind=data.get("kind", Location.Kind.IN_ROOM),
        title=title,
        requires_refinement=requires,
        refinement_label=label,
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order", 0),
        is_active=data.get("is_active", True),
    )


@transaction.atomic
def update_location(location_id, data: dict) -> Location:
    location = get_location(location_id)
    if "title" in data:
        title = _clean_translations(data["title"], field="title")
        if not title:
            raise ValidationError("Заполните название локации", field="title")
        location.title = title
    if "kind" in data:
        location.kind = data["kind"]
    if "requires_refinement" in data:
        location.requires_refinement = data["requires_refinement"]
    if "refinement_label" in data:
        location.refinement_label = _clean_translations(data["refinement_label"], field="refinement_label")
    if "schedule_id" in data:
        location.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data:
        location.sort_order = data["sort_order"]
    if "is_active" in data:
        location.is_active = data["is_active"]
    if "delivery_fee_minor" in data:
        fee = data["delivery_fee_minor"]
        if not isinstance(fee, int) or isinstance(fee, bool) or fee < 0:
            raise ValidationError(
                "Стоимость доставки — неотрицательное целое копеек",
                field="delivery_fee_minor",
                code="out_of_range",
            )
        location.delivery_fee_minor = fee

    _validate_refinement(location.requires_refinement, location.refinement_label or {})
    location.save()
    return location


def delete_location(location_id) -> None:
    get_location(location_id).delete()


# --- Матрица «категория → локации» -----------------------------------------


def location_matrix(language: str | None = None) -> dict:
    from apps.catalog.models import OfferingType

    locations = list(Location.objects.filter(is_active=True).order_by("sort_order", "code"))
    categories = list(Category.objects.order_by("sort_order", "code"))

    links = {
        (link.category_id, link.location_id): link
        for link in ServiceLocation.objects.all()
    }

    rows = []
    for category in categories:
        cells = []
        for location in locations:
            link = links.get((category.pk, location.pk))
            cells.append(
                {
                    "location_id": str(location.pk),
                    "enabled": bool(link and link.is_enabled),
                    "delivery_modes": list(link.delivery_modes) if link else [],
                }
            )
        rows.append(
            {
                "category_id": str(category.pk),
                "category_title": translate(category.title, language),
                "category_type": category.type,
                "cells": cells,
            }
        )

    return {
        "locations": [
            {"id": str(loc.pk), "code": loc.code, "title": translate(loc.title, language)}
            for loc in locations
        ],
        "rows": rows,
    }


@transaction.atomic
def update_matrix_row(category_id, cells: Iterable[dict]) -> dict:
    category = Category.objects.filter(pk=category_id).first()
    if category is None:
        raise ValidationError("Категория не найдена", field="category_id")

    valid_modes = set(dict(ServiceLocation.DeliveryMode.choices))
    for cell in cells:
        location_id = cell.get("location_id")
        location = Location.objects.filter(pk=location_id).first()
        if location is None:
            raise ValidationError("Локация не найдена", field="location_id")

        modes = [mode for mode in (cell.get("delivery_modes") or []) if mode in valid_modes]
        if not cell.get("enabled"):
            # Join-строка матрицы истории не несёт — удаляем жёстко, иначе
            # мягко-удалённая строка блокирует повторное включение уникальным
            # индексом (hotel, category, location).
            ServiceLocation.all_objects.filter(category=category, location=location).hard_delete()
            continue

        # all_objects: оживляем мягко-удалённую связку, а не плодим дубль.
        ServiceLocation.all_objects.update_or_create(
            category=category,
            location=location,
            defaults={"delivery_modes": modes or ["delivery"], "is_enabled": True, "deleted_at": None},
        )

    return location_matrix()


# --- Отделы ----------------------------------------------------------------


def serialize_department(point: ExecutionPoint, *, counts: dict | None = None) -> dict:
    counts = counts or {}
    return {
        "id": str(point.pk),
        "code": point.code,
        "title": point.title or {},
        "public_name": point.public_name or {},
        "tagline": point.tagline or {},
        "is_guest_facing": point.is_guest_facing,
        "kind": point.kind,
        "schedule_id": str(point.schedule_id) if point.schedule_id else None,
        "sla_minutes": point.sla_minutes,
        "is_active": point.is_active,
        "staff_count": counts.get("staff", 0),
        "channel_count": counts.get("channels", 0),
        "has_escalation": counts.get("escalation", False),
        "image": serialize_asset(point.image),
    }


def _resolve_asset(asset_id) -> MediaAsset | None:
    if not asset_id:
        return None
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise ValidationError("Изображение не найдено", field="image_id")
    return asset


def list_departments() -> list[dict]:
    from apps.accounts.models import StaffAssignment
    from apps.notifications.models import EscalationRule, NotificationChannel

    points = list(ExecutionPoint.objects.order_by("code"))
    staff = _count_by_point(StaffAssignment.objects.filter(is_active=True))
    channels = _count_by_point(NotificationChannel.objects.filter(is_active=True))
    with_rules = set(
        EscalationRule.objects.filter(is_active=True, execution_point__isnull=False).values_list(
            "execution_point_id", flat=True
        )
    )

    return [
        serialize_department(
            point,
            counts={
                "staff": staff.get(point.pk, 0),
                "channels": channels.get(point.pk, 0),
                "escalation": point.pk in with_rules,
            },
        )
        for point in points
    ]


def _count_by_point(queryset) -> dict:
    counts: dict = {}
    for point_id in queryset.values_list("execution_point_id", flat=True):
        if point_id:
            counts[point_id] = counts.get(point_id, 0) + 1
    return counts


def get_department(point_id) -> ExecutionPoint:
    point = ExecutionPoint.objects.filter(pk=point_id).first()
    if point is None:
        raise NotFoundError("Отдел не найден")
    return point


def _make_department_code(title: dict) -> str:
    from apps.catalog.cms_services import make_code

    return make_code(ExecutionPoint, title, prefix="dept")


@transaction.atomic
def create_department(data: dict) -> ExecutionPoint:
    title = _clean_translations(data.get("title"), field="title")
    if not title:
        raise ValidationError("Заполните название отдела", field="title")

    # Гостевое имя по умолчанию = служебное, чтобы точка не осталась безымянной
    # на витрине, пока отель не задал отдельное.
    public_name = _clean_translations(data.get("public_name"), field="public_name") or dict(title)
    tagline = _clean_translations(data.get("tagline"), field="tagline")
    return ExecutionPoint.objects.create(
        code=data.get("code") or _make_department_code(title),
        title=title,
        public_name=public_name,
        tagline=tagline,
        is_guest_facing=data.get("is_guest_facing", True),
        kind=data.get("kind", ExecutionPoint.Kind.OTHER),
        schedule=_resolve_schedule(data.get("schedule_id")),
        sla_minutes=data.get("sla_minutes", 20),
        is_active=data.get("is_active", True),
        image=_resolve_asset(data.get("image_id")),
    )


@transaction.atomic
def update_department(point_id, data: dict) -> ExecutionPoint:
    point = get_department(point_id)
    if "title" in data:
        title = _clean_translations(data["title"], field="title")
        if not title:
            raise ValidationError("Заполните название отдела", field="title")
        point.title = title
    if "public_name" in data:
        point.public_name = _clean_translations(data["public_name"], field="public_name")
    if "tagline" in data:
        point.tagline = _clean_translations(data["tagline"], field="tagline")
    if "is_guest_facing" in data and data["is_guest_facing"] is not None:
        point.is_guest_facing = data["is_guest_facing"]
    if "kind" in data:
        point.kind = data["kind"]
    if "schedule_id" in data:
        point.schedule = _resolve_schedule(data["schedule_id"])
    if "sla_minutes" in data and data["sla_minutes"] is not None:
        point.sla_minutes = data["sla_minutes"]
    if "is_active" in data:
        point.is_active = data["is_active"]
    if "image_id" in data:
        point.image = _resolve_asset(data["image_id"])
    point.save()
    return point


@transaction.atomic
def delete_department(point_id) -> None:
    from apps.orders.models import Order

    point = get_department(point_id)
    # Заказы ссылаются на точку через PROTECT — удаление осиротило бы историю.
    if Order.all_objects.filter(execution_point=point).exists():
        raise ConflictError(
            "У отдела есть заказы — его нельзя удалить, только выключить",
            code="department_in_use",
        )
    point.delete()
