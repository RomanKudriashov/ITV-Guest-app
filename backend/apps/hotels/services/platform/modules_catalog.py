"""
Каталог модулей в NaviRoom Control (партия 62-E1, по макету ModulesCatalogMock).

Каталог — что есть у платформы: модуль, работает он или в разработке, без
какого подключения не работает, у скольких отелей включён. Карточка модуля —
отели (поиск и фильтр «включён/выключен» на сервере, курсор) и журнал
включений из записей `platform.hotel.modules_set` (формат 62-D).

Отели — в области человека (`scope`): число и список чужих отелей — их карта.
"""

from __future__ import annotations

import base64
from typing import Any

from django.db.models import Q

from apps.core.context import platform_scope
from apps.core.models import AuditLog
from apps.hotels.models import Hotel, HotelModule
from apps.hotels.module_registry import ALL_CODES, MODULES, describe

MAX_LIMIT = 200


def _hotels(user):
    from apps.hotels.services.platform import scope

    return scope.allowed_hotels(user, Hotel.objects.filter(deleted_at__isnull=True))


def catalog(user=None) -> dict[str, Any]:
    hotels = list(_hotels(user).values_list("pk", flat=True))
    with platform_scope():
        enabled = (
            HotelModule.all_objects.using("platform")
            .filter(hotel_id__in=hotels, is_enabled=True, deleted_at__isnull=True)
            .values_list("code", flat=True)
        )
        counts: dict[str, int] = {}
        for code in enabled:
            counts[code] = counts.get(code, 0) + 1
    return {
        "hotels": len(hotels),
        "items": [{**describe(code), "enabled_hotels": counts.get(code, 0)} for code in ALL_CODES],
    }


def _encode(name: str, pk) -> str:
    return base64.urlsafe_b64encode(f"{name}|{pk}".encode()).decode()


def _decode(cursor: str) -> tuple[str, str] | None:
    try:
        name, _, pk = base64.urlsafe_b64decode(cursor.encode()).decode().partition("|")
        return name, pk
    except (ValueError, UnicodeDecodeError):
        return None


def module_card(code: str, params: dict, user=None) -> dict[str, Any]:
    from apps.core.errors import NotFoundError

    if code not in MODULES:
        raise NotFoundError("Такого модуля нет")
    limit = max(1, min(int(params.get("limit") or 50), MAX_LIMIT))
    state = params.get("state") or ""
    search = (params.get("search") or "").strip()

    allowed = _hotels(user)
    with platform_scope():
        enabled_ids = set(
            HotelModule.all_objects.using("platform")
            .filter(code=code, is_enabled=True, deleted_at__isnull=True)
            .values_list("hotel_id", flat=True)
        )
    base = allowed
    counts = {
        "on": base.filter(pk__in=enabled_ids).count(),
        "off": base.exclude(pk__in=enabled_ids).count(),
    }
    queryset = base
    if state == "on":
        queryset = queryset.filter(pk__in=enabled_ids)
    elif state == "off":
        queryset = queryset.exclude(pk__in=enabled_ids)
    if search:
        from django.db.models import TextField
        from django.db.models.functions import Cast

        queryset = queryset.annotate(_name=Cast("name", TextField())).filter(
            Q(_name__icontains=search) | Q(subdomain__icontains=search)
        )
    total = queryset.count()
    sort = (params.get("sort") or "").strip()
    offset = None
    if sort:
        # Столбец выбрал человек (партия 62-F): листание смещением `o:N`.
        from django.db.models import Case, IntegerField, TextField, Value, When
        from django.db.models.fields.json import KeyTextTransform
        from django.db.models.functions import Coalesce

        from apps.core.listing import order, russian

        sorts = {
            "name": russian(Coalesce(KeyTextTransform("ru", "name"), KeyTextTransform("en", "name"), "subdomain", output_field=TextField())),
            "subdomain": russian("subdomain"),
            "state": Case(When(pk__in=enabled_ids, then=Value(0)), default=Value(1), output_field=IntegerField()),
        }
        raw = params.get("cursor") or ""
        offset = int(raw[2:]) if raw.startswith("o:") and raw[2:].isdigit() else 0
        queryset = order(queryset, sort, params.get("dir"), sorts, default=("subdomain",), then=("subdomain", "pk"))
        rows = list(queryset[offset : offset + limit + 1])
    else:
        queryset = queryset.order_by("subdomain", "pk")
        cursor = _decode(params.get("cursor") or "") if params.get("cursor") else None
        if cursor:
            queryset = queryset.filter(Q(subdomain__gt=cursor[0]) | Q(subdomain=cursor[0], pk__gt=cursor[1]))
        rows = list(queryset[: limit + 1])
    more = len(rows) > limit
    rows = rows[:limit]

    with platform_scope():
        journal = list(
            AuditLog.all_objects.using("platform")
            .filter(action="platform.hotel.modules_set", payload__module=code)
            .filter(hotel_id__in=list(allowed.values_list("pk", flat=True)))
            .order_by("-created_at")[:50]
        )
        names = {h.pk: (h.name_i18n, h.subdomain) for h in Hotel.all_objects.using("platform").filter(pk__in={r.hotel_id for r in journal})}
    from apps.hotels.services.platform.journal import actors

    people = actors(r.actor_id for r in journal)
    return {
        **describe(code),
        "counts": counts,
        "hotels": {
            "items": [
                {
                    "id": str(h.pk),
                    "name": h.name_i18n,
                    "subdomain": h.subdomain,
                    "is_active": h.is_active,
                    "enabled": h.pk in enabled_ids,
                }
                for h in rows
            ],
            "total": total,
            "next_cursor": (
                (f"o:{offset + limit}" if offset is not None else _encode(rows[-1].subdomain, rows[-1].pk))
                if more and rows
                else None
            ),
        },
        "journal": [
            {
                "id": str(r.pk),
                "at": r.created_at.isoformat(),
                "hotel": names.get(r.hotel_id, ("", ""))[0],
                "subdomain": names.get(r.hotel_id, ("", ""))[1],
                "from": (r.payload or {}).get("from"),
                "to": (r.payload or {}).get("to"),
                "reason": (r.payload or {}).get("reason", ""),
                "actor": people.get(r.actor_id) or {"id": None, "name": "", "email": "", "role": "system"},
            }
            for r in journal
        ],
    }
