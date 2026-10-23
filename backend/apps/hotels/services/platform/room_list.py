"""
Номерной фонд отеля в карточке Control — только чтение (партия 62-B).

Номер, корпус, этаж, категория, вариант управления, есть ли PIN. Поиск и
фильтры считает сервер: у «Метрополя» 272 номера, и фильтровать их в браузере
значило бы везти все строки ради десяти.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


from apps.core.context import tenant_context
from apps.core.listing import natural_key, sort_rows
from apps.hotels.models import Hotel

LIMIT = 1000

# Столбцы номерного фонда. Номер и этаж — «по-человечески» (2 < 10 < 101,
# «3А» после «3»); PIN — «нет» выше: это и есть то, что ищут.
SORTS = {
    "number": ("natural", lambda r: r["number"]),
    "building": ("natural", lambda r: r["building"] or None),
    "floor": ("natural", lambda r: r["floor"] or None),
    "category": ("text", lambda r: r["category"] or None),
    "variant": ("text", lambda r: r["variant"]["title"] if r["variant"] else None),
    "pin": ("rank", lambda r: "no" if not r["pin"] else "yes", ("no", "yes")),
}
FACETS = ("building", "floor", "category", "variant", "pin")
NONE = "none"


def room_list(hotel: Hotel, params: dict[str, str]) -> dict[str, Any]:
    from apps.grms.models import RoomTypeRoom
    from apps.grms.services.access import active_pin_room_ids
    from apps.hotels.models import HotelModule, Room

    with tenant_context(hotel):
        room_control = HotelModule.objects.filter(code="room_control", is_enabled=True).exists()
        rooms = list(
            Room.objects.select_related("building", "category").order_by("sort_key", "number")
        )
        links = {
            link.room_id: link.room_type
            for link in RoomTypeRoom.objects.select_related("room_type")
        }
        # «Есть PIN» — то же правило, что у «Доступа» панели (63-1, укус 401).
        pins = active_pin_room_ids()
        rows = [_row(room, links.get(room.pk), room.pk in pins) for room in rooms]

    facets = {key: _facet(rows, key) for key in FACETS}
    search = (params.get("search") or "").strip().lower()
    chosen = {key: [v for v in (params.get(key) or "").split(",") if v] for key in FACETS}
    shown = [
        row
        for row in rows
        if (not search or search in row["number"].lower())
        and all(not values or row["facet"][key] in values for key, values in chosen.items())
    ]
    # Сортировка по столбцу (партия 62-F) — до предела выдачи: иначе первые
    # тысяча строк были бы первыми по умолчанию, а не по выбранному столбцу.
    shown = sort_rows(shown, params.get("sort"), params.get("dir"), SORTS, then=lambda r: natural_key(r["number"]))
    return {
        "room_control": room_control,
        "total": len(rows),
        "found": len(shown),
        "truncated": len(shown) > LIMIT,
        "items": [{k: v for k, v in row.items() if k != "facet"} for row in shown[:LIMIT]],
        "facets": facets,
    }


def _row(room, room_type, has_pin: bool) -> dict[str, Any]:
    building = room.building.title_i18n if room.building_id and room.building else room.zone
    category = room.category.title_i18n if room.category_id and room.category else ""
    variant = (
        {"code": room_type.code, "title": room_type.title_i18n or room_type.code}
        if room_type is not None
        else None
    )
    return {
        "id": str(room.pk),
        "number": room.number,
        "building": building or "",
        "floor": room.floor or "",
        "category": category,
        "variant": variant,
        "pin": has_pin,
        "is_active": room.is_active,
        "facet": {
            "building": building or NONE,
            "floor": room.floor or NONE,
            "category": category or NONE,
            "variant": variant["code"] if variant else NONE,
            "pin": "yes" if has_pin else "no",
        },
    }


def _natural(text: str) -> list:
    """«2» раньше «10»: этажи и корпуса сортируются как числа, где они числа."""
    import re

    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def _facet(rows: list[dict], key: str) -> list[dict[str, Any]]:
    """Значения фильтра со счётчиками; «не задано» — последним."""
    counts = Counter(row["facet"][key] for row in rows)
    labels: dict[str, str] = {}
    if key == "variant":
        labels = {row["variant"]["code"]: row["variant"]["title"] for row in rows if row["variant"]}
    values = sorted((v for v in counts if v != NONE), key=lambda v: _natural(labels.get(v, v)))
    if NONE in counts:
        values.append(NONE)
    return [{"value": v, "label": labels.get(v, v), "count": counts[v]} for v in values]
