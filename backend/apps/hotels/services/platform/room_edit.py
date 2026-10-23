"""
ПРАВКА НОМЕРНОГО ФОНДА ИЗ CONTROL (партия 63-1).

Слой Control поверх ТЕХ ЖЕ сервисов, что у панели отеля
(`services.admin_services`, `grms.services.builder`, `grms.services.pin`):
одна логика и одни проверки — заведение диапазоном, возврат удалённого,
подтверждение переименования, «занятый корпус не удаляется» — живут в одном
месте. Здесь только вход отеля и актора и то, чего у панели нет одной ручкой:
карточка номера целиком, вариант и имя устройства, PIN, история номера.

Актор — платформенный пользователь: сервисы панели пускают его как
администратора отеля (`roles.access_for`), а журнал записывает правку от
имени платформы, и она попадает в «Историю» отеля.
"""

from __future__ import annotations

import secrets
from contextlib import contextmanager
from typing import Any

from django.db import transaction

from apps.core.context import actor_context, tenant_context
from apps.core.errors import DomainError, NotFoundError
from apps.hotels.models import Hotel

# Длина сгенерированного PIN: шесть цифр — перебор закрыт счётчиком попыток,
# а продиктовать гостю всё ещё легко.
GENERATED_PIN_LENGTH = 6


class ModuleOff(DomainError):
    status = 409
    code = "module_disabled"


@contextmanager
def acting(hotel: Hotel, user):
    """Отель и актор правки — как у запроса панели этого отеля."""
    with tenant_context(hotel), actor_context(user):
        yield


def _invalidate(hotel: Hotel) -> None:
    # Сигналы сбрасывают кэш на `save()`; правки пачкой (`update`, перенос
    # номеров при удалении корпуса) их не зовут — сбрасываем явно.
    from apps.hotels.services.platform.readiness import invalidate

    invalidate(hotel.pk)


def _room(room_id):
    import uuid

    from apps.hotels.models import Room

    try:
        uuid.UUID(str(room_id))
    except ValueError:
        raise NotFoundError("Номер не найден") from None
    room = Room.objects.select_related("building", "category").filter(pk=room_id).first()
    if room is None:
        raise NotFoundError("Номер не найден")
    return room


# ── Справочники экрана ────────────────────────────────────────────────────


def dictionaries(hotel: Hotel, user) -> dict[str, Any]:
    """Корпуса, категории, варианты и языки отеля — для окон правки."""
    from apps.grms.models import RoomType
    from apps.hotels.models import HotelLanguage, HotelModule
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        buildings = svc.list_buildings()["items"]
        categories = svc.list_room_categories()["items"]
        variants = [
            {"code": t.code, "title": t.title_i18n or t.code, "device_template": t.device_name_template}
            for t in RoomType.objects.order_by("code")
        ]
        languages = [
            {"code": lang.code, "title": lang.title, "is_default": lang.is_default}
            for lang in HotelLanguage.objects.filter(is_active=True).order_by("sort_order", "code")
        ]
        room_control = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists()
    return {
        "buildings": buildings,
        "categories": categories,
        "variants": variants,
        "languages": languages or [{"code": hotel.default_language, "title": "", "is_default": True}],
        "room_control": room_control,
    }


# ── Карточка номера ───────────────────────────────────────────────────────


def room_detail(hotel: Hotel, user, room_id) -> dict[str, Any]:
    """Всё о номере для окна: поля, место, вариант, устройство, PIN, что мешает."""
    from django.utils import timezone

    from apps.accounts.models import GuestSession
    from apps.grms.models import RoomPin, RoomTypeRoom
    from apps.hotels.services import room_numbers
    from apps.hotels.services.platform.room_map import room_map

    with acting(hotel, user):
        room = _room(room_id)
        link = RoomTypeRoom.objects.select_related("room_type").filter(room=room).first()
        pin = RoomPin.objects.filter(room=room).first()
        sessions = GuestSession.objects.filter(room=room, revoked_at__isnull=True, expires_at__gt=timezone.now()).count()
    rule = room_numbers.rule_of(hotel)
    rule_floor, rule_position = room_numbers.read_number(room.number, rule)
    # Готовность и «что мешает» — тем же расчётом, что у схемы: одна правда.
    mapped = room_map(hotel, {"search": room.number})
    row = next((r for b in mapped["buildings"] for f in b["floors"] for r in f["rooms"] if r["id"] == str(room.pk)), None)
    template = (link.room_type.device_name_template or "") if link is not None else ""
    return {
        "id": str(room.pk),
        "number": room.number,
        "building_id": str(room.building_id) if room.building_id else None,
        "building": row["building"] if row else "",
        "floor": room.floor,
        "rule_floor": rule_floor,
        "position": room.position,
        "rule_position": rule_position,
        "category_id": str(room.category_id) if room.category_id else None,
        "is_active": room.is_active,
        "out_of_service": room.out_of_service,
        "variant": {"code": link.room_type.code, "title": link.room_type.title_i18n or link.room_type.code} if link is not None else None,
        "device": {
            "override": link.device_name_override if link is not None else "",
            "template": template,
            "effective": (link.device_name_override or template.replace("{room}", room.number)) if link is not None else "",
        },
        "pin": {
            "has": bool(pin and pin.is_active),
            "valid_until": pin.valid_until.isoformat() if pin and pin.valid_until else None,
            "issued_at": pin.issued_at.isoformat() if pin and pin.issued_at else None,
            "expired": bool(pin and pin.pin_hash and not pin.is_active),
        },
        "live_sessions": sessions,
        "control": row["control"] if row else "off",
        "problems": row["problems"] if row else [],
        "room_control": mapped["room_control"],
        "demo_entry": mapped["demo_entry"],
        "guest_url": hotel.room_deeplink(room.number),
    }


@transaction.atomic
def update_room(hotel: Hotel, user, room_id, data: dict) -> dict[str, Any]:
    """
    Правка номера: поля фонда — сервисом панели (с подтверждением
    переименования), вариант и имя устройства — сервисами GRMS.
    """
    from apps.grms.services import builder
    from apps.hotels.services import admin_services as svc

    fields = {k: v for k, v in data.items() if k in ROOM_FIELDS}
    with acting(hotel, user):
        room = _room(room_id)
        if fields:
            room = svc.update_room(room.pk, fields)
        if "variant" in data:
            before, after = builder.assign_room_type(hotel, room, data["variant"] or None)
            if before != after:
                svc._audit_room("room.variant_set", room, {"room": room.number, "changes": {"room_variant": {"from": before, "to": after}}})
        if "device_name" in data:
            before, after = builder.set_room_device(hotel, room, data["device_name"] or "")
            if before != after:
                svc._audit_room("room.device_set", room, {"room": room.number, "changes": {"room_device": {"from": before, "to": after}}})
    _invalidate(hotel)
    return room_detail(hotel, user, room_id)


ROOM_FIELDS = (
    "number",
    "confirm_rename",
    "keep_device_name",
    "floor",
    "position",
    "building_id",
    "category_id",
    "is_active",
    "out_of_service",
)


def rename_impact(hotel: Hotel, user, room_id, number: str) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        return svc.rename_impact(_room(room_id).pk, number)


def delete_impact(hotel: Hotel, user, room_id) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        return svc.room_delete_impact(_room(room_id).pk)


def delete_room(hotel: Hotel, user, room_id) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        result = svc.delete_room(_room(room_id).pk)
    _invalidate(hotel)
    return result


# ── Заведение пачкой ──────────────────────────────────────────────────────


def bulk_preview(hotel: Hotel, user, data: dict) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        return svc.preview_bulk_rooms(data)


def bulk_create(hotel: Hotel, user, data: dict) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        result = svc.bulk_create_rooms(data)
    _invalidate(hotel)
    return result


# ── PIN ───────────────────────────────────────────────────────────────────


def set_pin(hotel: Hotel, user, room_id, *, pin: str = "", generate: bool = False, valid_until=None) -> dict:
    """
    Задать PIN руками или сгенерировать. Сгенерированный возвращается ОДИН раз
    — в этом ответе; заданный руками не возвращается вовсе: его знает тот, кто
    задал. В базе — только хэш.
    """
    from apps.grms.api.cms.access import _end_of_day
    from apps.grms.services import pin as room_pin

    _require_module(hotel)
    code = "".join(secrets.choice("0123456789") for _ in range(GENERATED_PIN_LENGTH)) if generate else pin
    with acting(hotel, user):
        room = _room(room_id)
        record = room_pin.set_pin(hotel, room, pin=code, valid_until=_end_of_day(hotel, valid_until) if valid_until else None)
    return {
        "has": True,
        "pin": code if generate else None,
        "valid_until": record.valid_until.isoformat() if record.valid_until else None,
    }


def clear_pin(hotel: Hotel, user, room_id) -> dict:
    from apps.grms.services import pin as room_pin

    _require_module(hotel)
    with acting(hotel, user):
        room_pin.clear_pin(hotel, _room(room_id))
    return {"has": False}


def _require_module(hotel: Hotel) -> None:
    from apps.hotels.models import HotelModule

    with tenant_context(hotel):
        on = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists()
    if not on:
        raise ModuleOff("Управление номером этому отелю не подключено — PIN не нужен")


# ── История номера ────────────────────────────────────────────────────────


def room_history(hotel: Hotel, room_id, limit: int = 50) -> dict:
    """
    Всё, что случалось с номером: правки Control и панели, PIN, выезды. Одна
    выборка по объекту журнала — записи номера пишутся с `object_id` номера.
    """
    from apps.core.context import platform_scope
    from apps.core.models import AuditLog
    from apps.hotels.services.platform.journal import actors, serialize

    with tenant_context(hotel):
        room = _room(room_id)
    with platform_scope():
        rows = list(
            AuditLog.all_objects.using("platform")
            .filter(hotel_id=hotel.pk, object_id=room.pk)
            .exclude(action="grms.pin_attempt")
            .order_by("-created_at")[: max(1, min(limit, 200))]
        )
    people = actors(row.actor_id for row in rows)
    return {"items": [serialize(row, people) for row in rows]}


# ── Корпуса и категории ───────────────────────────────────────────────────


def save_dictionary(hotel: Hotel, user, kind: str, item_id: str | None, data: dict) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        if kind == "building":
            obj = svc.update_building(item_id, data) if item_id else svc.create_building(data)
            result = svc.serialize_building(obj)
        else:
            obj = svc.update_room_category(item_id, data) if item_id else svc.create_room_category(data)
            result = svc.serialize_room_category(obj)
    _invalidate(hotel)
    return result


def delete_dictionary(hotel: Hotel, user, kind: str, item_id: str, move_to: str | None) -> dict:
    from apps.hotels.services import admin_services as svc

    with acting(hotel, user):
        if kind == "building":
            moved = svc.delete_building(item_id, move_to=move_to)
        else:
            moved = svc.delete_room_category(item_id, move_to=move_to)
    _invalidate(hotel)
    return {"ok": True, "moved": moved}
