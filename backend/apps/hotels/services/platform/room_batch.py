"""
ДЕЙСТВИЯ НАД МНОГИМИ НОМЕРАМИ ИЗ CONTROL (партия 63-2).

Сначала показ, потом выполнение — как действия группы (62-A2), но строже:

* показ (`preview`) по каждому номеру говорит «изменится / уже так / нельзя
  (почему)», итог — числами, и отдаёт ПОДПИСАННЫЙ билет: какие номера и что
  именно с ними сделать;
* выполнение (`execute`) берёт номера ТОЛЬКО из билета. Номер, которого в
  показе не было, не тронется, даже если его дописали в запрос; номер, с
  которым после показа уже всё так, пропускается;
* всё — одной транзакцией: ошибка на одном номере откатывает все;
* в «Историю» отеля — одна запись действия со списком «было → стало».

Работает через те же сервисы, что у панели отеля и окна номера: вариант —
`grms.services.builder`, PIN — `grms.services.pin`, поля фонда —
`admin_services.bulk_update_rooms`, удаление — `admin_services.delete_room`.

PIN выдаются каждому свой, случайный, и возвращаются ОДИН раз — в ответе
выполнения. Ни в журнал, ни в логи коды не пишутся.
"""

from __future__ import annotations

import secrets
from datetime import date
from typing import Any

from django.core import signing
from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import DomainError, NotFoundError, ValidationError
from apps.hotels.models import Hotel
from apps.hotels.services.platform.room_edit import GENERATED_PIN_LENGTH, acting

LIMIT = 500
SALT = "rooms.batch.v1"
# Билет живёт, пока человек смотрит на показ: дольше — пусть покажет заново.
TICKET_TTL = 30 * 60

ACTIONS = (
    "variant_set",
    "variant_clear",
    "pin_issue",
    "pin_clear",
    "pin_until",
    "category",
    "building",
    "out_of_service",
    "active",
    "delete",
)
# Действия, которым нужен включённый модуль «Управление номером».
NEEDS_MODULE = ("pin_issue", "pin_clear", "pin_until")


class StaleTicket(DomainError):
    status = 409
    code = "batch_ticket_stale"


def _check(action: str, value: Any, room_ids: list[str]) -> None:
    if action not in ACTIONS:
        raise ValidationError("Неизвестное действие", field="action", code="unknown_action")
    if not room_ids:
        raise ValidationError("Не выбрано ни одного номера", field="room_ids", code="empty_selection")
    if len(room_ids) > LIMIT:
        raise ValidationError(
            f"За один раз не больше {LIMIT} номеров, а выбрано {len(room_ids)}",
            field="room_ids",
            code="too_many_rooms",
        )
    if action == "variant_set" and not value:
        raise ValidationError("Выберите вариант", field="value")
    if action in ("out_of_service", "active") and not isinstance(value, bool):
        raise ValidationError("Нужно «включить» или «выключить»", field="value")


def _date(value) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError("Дата в виде ГГГГ-ММ-ДД", field="value") from None


def _context(hotel: Hotel, ids: list[str]) -> dict:
    """Всё о выбранных номерах одним походом: варианты, PIN, корпуса, категории, сессии."""
    from apps.accounts.models import GuestSession
    from apps.grms.models import RoomPin, RoomType, RoomTypeRoom
    from apps.hotels.models import Building, HotelModule, Room, RoomCategory

    import uuid

    clean = []
    for value in ids:
        try:
            clean.append(uuid.UUID(str(value)))
        except ValueError:
            continue
    with tenant_context(hotel):
        rooms = {str(r.pk): r for r in Room.objects.select_related("building", "category").filter(pk__in=clean)}
        links = {str(l.room_id): l.room_type for l in RoomTypeRoom.objects.select_related("room_type").filter(room_id__in=clean)}
        pins = {str(p.room_id): p for p in RoomPin.objects.filter(room_id__in=clean)}
        live = set(
            str(s)
            for s in GuestSession.objects.filter(room_id__in=clean, revoked_at__isnull=True, expires_at__gt=timezone.now()).values_list("room_id", flat=True)
        )
        return {
            "rooms": rooms,
            "links": links,
            "pins": pins,
            "live": live,
            "module": HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists(),
            "types": {t.code: t for t in RoomType.objects.all()},
            "buildings": {str(b.pk): b for b in Building.objects.all()},
            "categories": {str(c.pk): c for c in RoomCategory.objects.all()},
        }


def _title(obj) -> str | None:
    if obj is None:
        return None
    return obj.title_i18n or getattr(obj, "code", "") or None


def _target(action: str, value: Any, ctx: dict):
    """Значение «стало» словами — и проверка, что оно существует."""
    if action == "variant_set":
        room_type = ctx["types"].get(str(value))
        if room_type is None:
            raise NotFoundError("Вариант не найден")
        return room_type
    if action in ("building", "category"):
        if value in (None, "", "none"):
            return None
        pool = ctx["buildings"] if action == "building" else ctx["categories"]
        found = pool.get(str(value))
        if found is None:
            raise NotFoundError("Корпус не найден" if action == "building" else "Категория не найдена")
        return found
    return value


def _row(action: str, room, target, valid_until: date | None, ctx: dict) -> dict[str, Any]:
    """Что будет с номером: change / same / refused, «было → стало» словами."""
    rid = str(room.pk)
    link = ctx["links"].get(rid)
    pin = ctx["pins"].get(rid)
    has_pin = bool(pin and pin.is_active)
    row: dict[str, Any] = {"id": rid, "number": room.number, "outcome": "change", "reason": None, "from": None, "to": None}

    def outcome(before, after):
        row["from"], row["to"] = before, after
        if before == after:
            row["outcome"] = "same"

    if action in NEEDS_MODULE and not ctx["module"]:
        row.update(outcome="refused", reason="module_off")
        return row
    if action == "variant_set":
        outcome(_title(link), _title(target))
        row["variant_changes"] = link is not None and link.code != target.code
    elif action == "variant_clear":
        outcome(_title(link), None)
    elif action == "pin_issue":
        row["from"], row["to"] = has_pin, True
        row["replaces"] = has_pin
    elif action == "pin_clear":
        outcome(bool(pin and pin.pin_hash), False)
    elif action == "pin_until":
        if not has_pin:
            row.update(outcome="refused", reason="no_pin")
            return row
        before = timezone.localtime(pin.valid_until).date().isoformat() if pin.valid_until else None
        outcome(before, valid_until.isoformat() if valid_until else None)
    elif action == "category":
        outcome(_title(room.category) if room.category_id else None, _title(target))
    elif action == "building":
        outcome(_title(room.building) if room.building_id else None, _title(target))
    elif action == "out_of_service":
        outcome(room.out_of_service, bool(target))
    elif action == "active":
        outcome(room.is_active, bool(target))
    elif action == "delete":
        row["from"], row["to"] = True, False
        row["consequences"] = {"pin": has_pin, "sessions": rid in ctx["live"], "variant": _title(link)}
    return row


def _plan(hotel: Hotel, action: str, value: Any, room_ids: list[str]) -> tuple[list[dict], dict]:
    ctx = _context(hotel, room_ids)
    target = _target(action, value, ctx)
    valid_until = _date(value) if action in ("pin_until", "pin_issue") else None
    rows = []
    for rid in room_ids:
        room = ctx["rooms"].get(str(rid))
        if room is None:
            rows.append({"id": str(rid), "number": None, "outcome": "refused", "reason": "not_found", "from": None, "to": None})
            continue
        rows.append(_row(action, room, target, valid_until, ctx))
    rows.sort(key=lambda r: (r["number"] is None, _natural(r["number"] or "")))
    return rows, ctx


def _natural(number: str):
    from apps.core.listing import natural_key

    return natural_key(number)


def _summary(action: str, rows: list[dict]) -> dict[str, Any]:
    change = [r for r in rows if r["outcome"] == "change"]
    warnings: dict[str, int] = {}
    if action == "variant_set":
        warnings["variant_changes"] = sum(1 for r in change if r.get("variant_changes"))
    if action == "pin_issue":
        warnings["pin_replaces"] = sum(1 for r in change if r.get("replaces"))
    if action == "delete":
        warnings["pins"] = sum(1 for r in change if r["consequences"]["pin"])
        warnings["sessions"] = sum(1 for r in change if r["consequences"]["sessions"])
        warnings["variants"] = sum(1 for r in change if r["consequences"]["variant"])
    return {
        "change": len(change),
        "same": sum(1 for r in rows if r["outcome"] == "same"),
        "refused": sum(1 for r in rows if r["outcome"] == "refused"),
        "warnings": {k: v for k, v in warnings.items() if v},
    }


def preview(hotel: Hotel, user, action: str, value: Any, room_ids: list[str]) -> dict[str, Any]:
    _check(action, value, room_ids)
    rows, _ = _plan(hotel, action, value, list(dict.fromkeys(room_ids)))
    change_ids = [r["id"] for r in rows if r["outcome"] == "change"]
    ticket = signing.dumps(
        {"hotel": str(hotel.pk), "action": action, "value": value, "ids": change_ids, "user": str(user.pk)},
        salt=SALT,
    )
    return {"action": action, "rows": rows, "summary": _summary(action, rows), "ticket": ticket if change_ids else None}


def execute(hotel: Hotel, user, ticket: str, room_ids: list[str], *, ip: str | None = None) -> dict[str, Any]:
    """
    Выполнить РОВНО показанное: номера — пересечение билета и присланного
    списка, и только те, с которыми действие по-прежнему что-то меняет.
    """
    try:
        data = signing.loads(ticket or "", salt=SALT, max_age=TICKET_TTL)
    except signing.SignatureExpired:
        raise StaleTicket("Показ устарел — покажите, что изменится, ещё раз") from None
    except signing.BadSignature:
        raise ValidationError("Сначала покажите, что изменится", field="ticket", code="batch_ticket_invalid") from None
    if data.get("hotel") != str(hotel.pk) or data.get("user") != str(user.pk):
        raise ValidationError("Показ сделан для другого отеля или человека", field="ticket", code="batch_ticket_invalid")
    action, value = data["action"], data.get("value")
    sent = {str(r) for r in room_ids}
    # Только показанное: дописанный в запрос номер в билете не значится.
    ids = [rid for rid in data["ids"] if rid in sent]
    if not ids:
        return {"done": 0, "skipped": 0, "rows": [], "pins": []}
    rows, ctx = _plan(hotel, action, value, ids)
    todo = [r for r in rows if r["outcome"] == "change"]
    skipped = len(rows) - len(todo)
    pins: list[dict[str, str]] = []
    with acting(hotel, user), transaction.atomic():
        _apply(hotel, action, value, todo, ctx, pins)
        _journal(hotel, user, action, value, todo, ctx, ip)
    from apps.hotels.services.platform.readiness import invalidate

    invalidate(hotel.pk)
    return {
        "done": len(todo),
        "skipped": skipped,
        "rows": [{"id": r["id"], "number": r["number"], "from": r["from"], "to": r["to"]} for r in todo],
        # Коды — только здесь и один раз. В журнал и логи не уходят.
        "pins": pins,
    }


def _apply(hotel: Hotel, action: str, value: Any, todo: list[dict], ctx: dict, pins: list) -> None:
    from apps.grms.api.cms.access import _end_of_day
    from apps.grms.services import builder, pin as room_pin
    from apps.hotels.services import admin_services as svc

    rooms = ctx["rooms"]
    ids = [r["id"] for r in todo]
    if action in ("category", "building", "out_of_service", "active"):
        field = {"category": "category_id", "building": "building_id", "out_of_service": "out_of_service", "active": "is_active"}[action]
        patch_value = (None if value in (None, "", "none") else str(value)) if action in ("category", "building") else bool(value)
        # Снять корпус или категорию пачкой: у сервиса панели пустое значение —
        # «не менять», поэтому «снять» — отдельной правкой по одному.
        if patch_value is None:
            for rid in ids:
                svc.update_room(rid, {field: None}, audit=False)
        else:
            svc.bulk_update_rooms({"selection": {"ids": ids}, "patch": {field: patch_value}}, audit=False)
        return
    for rid in ids:
        room = rooms[rid]
        if action == "variant_set":
            builder.assign_room_type(hotel, room, str(value))
        elif action == "variant_clear":
            builder.assign_room_type(hotel, room, None)
        elif action == "pin_issue":
            code = "".join(secrets.choice("0123456789") for _ in range(GENERATED_PIN_LENGTH))
            until = _date(value)
            room_pin.set_pin(hotel, room, pin=code, valid_until=_end_of_day(hotel, until) if until else None, journal=False)
            pins.append({"number": room.number, "pin": code})
        elif action == "pin_clear":
            room_pin.clear_pin(hotel, room, journal=False)
        elif action == "pin_until":
            until = _date(value)
            room_pin.set_validity(hotel, room, _end_of_day(hotel, until) if until else None)
        elif action == "delete":
            svc.delete_room(rid, audit=False)
    pins.sort(key=lambda p: _natural(p["number"]))


def _journal(hotel: Hotel, user, action: str, value: Any, todo: list[dict], ctx: dict, ip: str | None) -> None:
    """Одна запись на действие: что сделано и список номеров «было → стало» (без PIN)."""
    from apps.core.models import AuditLog

    label = value
    if action == "variant_set":
        label = _title(ctx["types"].get(str(value)))
    elif action in ("building", "category"):
        pool = ctx["buildings"] if action == "building" else ctx["categories"]
        label = _title(pool.get(str(value))) if value not in (None, "", "none") else None
    AuditLog.record(
        "room.batch",
        actor_type=AuditLog.ActorType.PLATFORM,
        actor_id=user.pk,
        object_type="hotel",
        object_id=hotel.pk,
        hotel_id=hotel.pk,
        ip_address=ip,
        payload={
            "batch": action,
            "value": label,
            "count": len(todo),
            # «Стало» у выдачи PIN — «есть», а не сам код.
            "rows": [{"room": r["number"], "from": r["from"], "to": r["to"]} for r in todo],
        },
    )
