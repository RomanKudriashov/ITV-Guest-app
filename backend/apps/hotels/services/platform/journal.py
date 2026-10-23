"""
Журнал Control одним кодом (партия 62-D): «История» отеля и «Журнал действий».

У каждой записи — кто (имя и роль), что (раздел и действие), объект и
«было → стало». Фильтры считает сервер: кто, что (раздел и поле), период,
отель, группа, текст. Листание — курсором `время|id`, без потолка в 50.

ОДНО ДЕЙСТВИЕ — ОДНА ЗАПИСЬ. До партии 62-D вход поддержки, публикация и
откат конфигурации номера писались дважды (ручка и сервис). Новые дубли не
пишутся; старые в показе не участвуют — `LEGACY_DUPLICATES` исключаются
выборкой, их пара (`impersonation.started`, `grms.publish`, `grms.rollback`)
лежит рядом и несёт то же самое.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta
from typing import Any

from django.db.models import Q, TextField
from django.db.models.functions import Cast
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.core.models import AuditLog

LEGACY_DUPLICATES = ("platform.hotel.entered", "grms.published", "grms.rolled_back")
SUPPORT_ACTIONS = ("impersonation.started", "impersonation.revoked")
NODE_ACTIONS = ("platform.node.registered", "platform.node.reissued", "platform.node.revoked")
ADMIN_ACTIONS = ("platform.hotel.admin_set", "platform.hotel.admin_email_changed", "platform.hotel.admin_removed")
# Номерной фонд (63-1): правило номеров, номера, корпуса, категории. Записи
# номера пишут сервисы панели — от имени того, кто правит; в «Историю» из них
# попадают правки Control (актор — платформа).
ROOMS_ACTIONS = ("platform.hotel.rooms_rule_set", "platform.hotel.room_place_set")
ROOMS_PREFIXES = ("room.", "building.", "room_category.")
ROOMS_Q = Q(action__in=ROOMS_ACTIONS) | Q(action__startswith="room.") | Q(action__startswith="building.") | Q(action__startswith="room_category.")

# Раздел «Истории» → действия. Поля профиля — ключи `changes`.
SECTIONS: dict[str, Q] = {
    "profile": Q(action__in=("platform.hotel.created",))
    | (Q(action="platform.hotel.updated") & ~Q(payload__changes__has_key="group")),
    "modules": Q(action="platform.hotel.modules_set"),
    "connections": Q(action__in=NODE_ACTIONS),
    "group": Q(action="platform.hotel.updated", payload__changes__has_key="group"),
    "activation": Q(action__in=("platform.hotel.activated", "platform.hotel.deactivated")),
    "admins": Q(action__in=ADMIN_ACTIONS),
    "rooms": ROOMS_Q,
    "roomControl": Q(action__startswith="grms."),
    "support": Q(action__startswith="impersonation."),
    "data": Q(action__in=("platform.hotel.offboard_marked", "platform.hotel.purged", "platform.hotel.offboard_cancelled", "platform.hotel.exported")),
}
PERIODS = {"day": 1, "week": 7, "month": 31, "quarter": 92, "year": 366}
MAX_LIMIT = 200


def section_of(action: str, payload: dict) -> str:
    for key, _ in SECTIONS.items():
        if _matches(key, action, payload):
            return key
    return "other"


def _matches(key: str, action: str, payload: dict) -> bool:
    changes = payload.get("changes") if isinstance(payload, dict) else None
    has_group = isinstance(changes, dict) and "group" in changes
    if key == "profile":
        return action == "platform.hotel.created" or (action == "platform.hotel.updated" and not has_group)
    if key == "group":
        return action == "platform.hotel.updated" and has_group
    if key == "modules":
        return action == "platform.hotel.modules_set"
    if key == "connections":
        return action in NODE_ACTIONS
    if key == "activation":
        return action in ("platform.hotel.activated", "platform.hotel.deactivated")
    if key == "admins":
        return action in ADMIN_ACTIONS
    if key == "rooms":
        return action in ROOMS_ACTIONS or action.startswith(ROOMS_PREFIXES)
    if key == "roomControl":
        return action.startswith("grms.")
    if key == "support":
        return action.startswith("impersonation.")
    if key == "data":
        return action in ("platform.hotel.offboard_marked", "platform.hotel.purged", "platform.hotel.offboard_cancelled", "platform.hotel.exported")
    return False


def what_filter(values: list[str]) -> Q | None:
    """«Что»: раздел (`modules`) или поле раздела (`profile:timezone`)."""
    query = Q()
    used = False
    for value in values:
        section, _, field = value.partition(":")
        if section not in SECTIONS:
            continue
        part = SECTIONS[section]
        if field:
            part = part & Q(payload__changes__has_key=field)
        query |= part
        used = True
    return query if used else None


def period_start(period: str) -> datetime | None:
    days = PERIODS.get(period or "")
    return timezone.now() - timedelta(days=days) if days else None


def moment(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.replace(" ", "+")
    parsed = parse_datetime(value)
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def journal_sorts(*, with_hotel: bool) -> dict:
    """
    Столбцы журнала (партия 62-F): когда, кто (по почте человека), что (по
    коду действия — одинаковые рядом), отель (по названию на русском, иначе
    по-английски). Система — без автора — в конце.
    """
    from django.db.models import OuterRef, Subquery
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Coalesce

    from apps.accounts.models import User
    from apps.core.listing import russian
    from apps.hotels.models import Hotel

    sorts = {
        "at": "created_at",
        "who": russian(Subquery(User.all_objects.filter(pk=OuterRef("actor_id")).values("email")[:1])),
        "action": "action",
    }
    if with_hotel:
        sorts["hotel"] = russian(Subquery(
            Hotel.all_objects.filter(pk=OuterRef("hotel_id"))
            .annotate(
                label=Coalesce(
                    KeyTextTransform("ru", "name"), KeyTextTransform("en", "name"), "subdomain", output_field=TextField()
                )
            )
            .values("label")[:1]
        ))
    return sorts


def page_rows(queryset, params: dict, *, limit: int, with_hotel: bool) -> tuple[list, str | None]:
    """
    Страница журнала: по умолчанию — курсором «время|id» (журнал пополняется
    во время просмотра); если человек выбрал столбец — смещением `o:N`, по
    тому же столбцу (составной курсор по произвольному столбцу ломался бы на
    пустых значениях).
    """
    from apps.core.listing import order

    sort = (params.get("sort") or "").strip()
    cursor = params.get("cursor") or ""
    if not sort:
        rows = list(after_cursor(queryset, cursor).order_by("-created_at", "-pk")[: limit + 1])
        more = len(rows) > limit
        rows = rows[:limit]
        return rows, encode_cursor(rows[-1]) if more and rows else None
    offset = int(cursor[2:]) if cursor.startswith("o:") and cursor[2:].isdigit() else 0
    ordered = order(queryset, sort, params.get("dir"), journal_sorts(with_hotel=with_hotel), default=("-created_at",), then=("-created_at", "-pk"))
    rows = list(ordered[offset : offset + limit + 1])
    more = len(rows) > limit
    return rows[:limit], f"o:{offset + limit}" if more else None


def encode_cursor(row: AuditLog) -> str:
    return base64.urlsafe_b64encode(f"{row.created_at.isoformat()}|{row.pk}".encode()).decode()


def after_cursor(queryset, cursor: str | None):
    """Строго раньше записи курсора. Старый вид курсора (`время|id`) тоже понятен."""
    if not cursor:
        return queryset
    raw = cursor
    if "|" not in raw:
        try:
            raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        except (ValueError, UnicodeDecodeError):
            return queryset
    at, _, row_id = raw.partition("|")
    point = moment(at)
    if point is None or not row_id:
        return queryset
    return queryset.filter(Q(created_at__lt=point) | Q(created_at=point, pk__lt=row_id))


def text_filter(queryset, term: str, *, actor_ids: list | None = None, hotel_ids: list | None = None):
    """Текст — по содержимому записи, по имени и почте того, кто сделал, и (в журнале) по отелю."""
    term = (term or "").strip()
    if not term:
        return queryset
    query = Q(action__icontains=term) | Q(payload_text__icontains=term)
    if actor_ids:
        query |= Q(actor_id__in=actor_ids)
    if hotel_ids:
        query |= Q(hotel_id__in=hotel_ids)
    return queryset.annotate(payload_text=Cast("payload", TextField())).filter(query)


def actors(ids) -> dict:
    """Кто: имя (или почта) и роль платформы."""
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    ids = {i for i in ids if i}
    if not ids:
        return {}
    with platform_scope():
        users = User.all_objects.using("platform").filter(pk__in=ids)
        return {
            user.pk: {
                "id": str(user.pk),
                "name": user.full_name or user.email,
                "email": user.email,
                "role": user.platform_role if user.is_platform_admin else "hotel",
            }
            for user in users
        }


def matching_actors(term: str) -> list:
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    term = (term or "").strip()
    if not term:
        return []
    with platform_scope():
        return list(
            User.all_objects.using("platform")
            .filter(is_platform_admin=True)
            .filter(Q(email__icontains=term) | Q(full_name__icontains=term))
            .values_list("pk", flat=True)
        )


def changes_of(row: AuditLog) -> list[dict[str, Any]]:
    """«Было → стало» записи одним видом: [{field, from, to}]."""
    payload = row.payload or {}
    if row.action == "platform.hotel.modules_set" and "module" in payload:
        return [{"field": f"module:{payload['module']}", "from": payload.get("from"), "to": payload.get("to")}]
    changes = payload.get("changes")
    if isinstance(changes, dict):
        out = []
        for field, change in changes.items():
            if isinstance(change, dict) and ("from" in change or "to" in change):
                out.append({"field": field, "from": change.get("from"), "to": change.get("to")})
        return out
    return []


def object_of(row: AuditLog) -> dict | None:
    """Над чем: модуль, узел, вариант номера, вход поддержки."""
    payload = row.payload or {}
    if row.action == "platform.hotel.modules_set" and payload.get("module"):
        return {"kind": "module", "code": payload["module"]}
    if row.action in NODE_ACTIONS and payload.get("node"):
        return {"kind": "node", "name": payload["node"]}
    if row.action.startswith("grms.") and payload.get("type"):
        return {"kind": "variant", "code": payload["type"], "version": payload.get("version") or payload.get("new_version")}
    if (row.action in ("platform.hotel.room_place_set", "grms.pin_set", "grms.pin_cleared") or row.action.startswith("room.")) and payload.get("room"):
        return {"kind": "room", "number": payload["room"]}
    if row.action.startswith("building.") and payload.get("title"):
        return {"kind": "building", "name": payload["title"]}
    if row.action.startswith("room_category.") and payload.get("title"):
        return {"kind": "category", "name": payload["title"]}
    if row.action.startswith("impersonation."):
        return {"kind": "support"}
    return None


def details_of(row: AuditLog) -> dict:
    """Подробности, которых нет в «было → стало»: причина, дата, число, версия."""
    payload = row.payload or {}
    keep = (
        "reason", "enable_on", "auto", "bulk", "group", "to_version", "ttl_minutes", "count", "purpose", "types",
        # Номерной фонд (63-1): сколько заведено, перенесено, отозвано сессий.
        "created", "skipped", "moved", "revoked",
    )
    return {key: payload[key] for key in keep if key in payload and payload[key] not in (None, "")}


def serialize(row: AuditLog, people: dict) -> dict:
    person = people.get(row.actor_id)
    return {
        "id": str(row.pk),
        "at": row.created_at.isoformat(),
        "action": row.action,
        "section": section_of(row.action, row.payload or {}),
        "actor": person or ({"id": None, "name": "", "email": "", "role": "system"} if not row.actor_id else {"id": str(row.actor_id), "name": "", "email": "", "role": ""}),
        "via_support": bool(row.impersonated_by) and row.action not in SUPPORT_ACTIONS,
        "object": object_of(row),
        "changes": changes_of(row),
        "details": details_of(row),
        # Сырой payload остаётся инженеру — экран рисует по полям выше.
        "payload": row.payload,
    }


# Кто попадает в «Историю» отеля: люди Control и СИСТЕМА, когда она правит
# отель от имени платформы (миграция 0049 выключила модули в разработке,
# расписание включает отключённый отель). Системные записи отеля другого
# рода — заказы, оборудование — в «Историю» правок не идут.
HISTORY_ACTORS = Q(actor_type=AuditLog.ActorType.PLATFORM) | Q(
    actor_type=AuditLog.ActorType.SYSTEM, action__startswith="platform."
)


def hotel_history(hotel, params: dict) -> dict:
    """«История» отеля: все правки из Control, с фильтрами и курсором."""
    from apps.core.context import platform_scope

    limit = max(1, min(int(params.get("limit") or 50), MAX_LIMIT))
    who = [v for v in (params.get("who") or "").split(",") if v]
    what = [v for v in (params.get("what") or "").split(",") if v]
    with platform_scope():
        base = (
            AuditLog.all_objects.using("platform")
            .filter(hotel_id=hotel.pk)
            .filter(HISTORY_ACTORS)
            .exclude(action__in=LEGACY_DUPLICATES)
        )
        facets = _history_facets(base)
        queryset = base
        if who:
            query = Q(actor_id__in=[w for w in who if w != "system"])
            if "system" in who:
                query |= Q(actor_id__isnull=True)
            queryset = queryset.filter(query)
        what_q = what_filter(what)
        if what_q is not None:
            queryset = queryset.filter(what_q)
        start = period_start(params.get("period") or "") or moment(params.get("since"))
        if start:
            queryset = queryset.filter(created_at__gte=start)
        end = moment(params.get("until"))
        if end:
            queryset = queryset.filter(created_at__lte=end)
        term = params.get("search") or ""
        queryset = text_filter(queryset, term, actor_ids=matching_actors(term))
        total = queryset.count()
        rows, next_cursor = page_rows(queryset, params, limit=limit, with_hotel=False)
    people = actors(row.actor_id for row in rows)
    return {
        "items": [serialize(row, people) for row in rows],
        "total": total,
        "next_cursor": next_cursor,
        "facets": facets,
    }


def _history_facets(base) -> dict:
    from collections import Counter

    rows = list(base.values_list("actor_id", "action", "payload"))
    who = Counter(str(actor) if actor else "system" for actor, _, _ in rows)
    sections = Counter(section_of(action, payload or {}) for _, action, payload in rows)
    fields: Counter = Counter()
    for _, action, payload in rows:
        changes = (payload or {}).get("changes") if isinstance(payload, dict) else None
        if action == "platform.hotel.updated" and isinstance(changes, dict):
            for field in changes:
                if field != "group":
                    fields[f"profile:{field}"] += 1
    people = actors(a for a in {actor for actor, _, _ in rows} if a)
    return {
        "who": [
            {"value": key, "label": (people.get(_uuid(key)) or {}).get("name", "") if key != "system" else "", "role": (people.get(_uuid(key)) or {}).get("role", "system" if key == "system" else ""), "count": n}
            for key, n in who.most_common()
        ],
        "what": [{"value": key, "count": n} for key, n in sections.most_common() if key != "other"]
        + [{"value": key, "count": n} for key, n in sorted(fields.items())],
    }


def _uuid(value: str):
    import uuid

    try:
        return uuid.UUID(value)
    except (ValueError, TypeError):
        return None
