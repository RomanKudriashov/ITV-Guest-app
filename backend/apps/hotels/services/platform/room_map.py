"""
СХЕМА НОМЕРНОГО ФОНДА в карточке отеля Control (партия 63-1).

Корпуса → этажи → номера с позицией на этаже (стояком): номера с одинаковой
позицией стоят друг под другом. Этаж и позиция — заданные у номера или
прочитанные из номера по правилу отеля (`services/room_numbers.py`); откуда
взято — сказано у каждого номера.

По каждому номеру — готовность управления и что ей мешает. Это вывод из
настроек, а не опрос оборудования:

* `off`       — управление номером отелю не подключено или номер выключен;
* `blocked`   — гость не сможет управлять: нет связи с отелем, нет варианта,
                вариант не опубликован, нет PIN (а вход без PIN выключен);
* `attention` — гость сможет, но не так, как задумано: PIN нет, гость входит
                демо-входом;
* `ok`        — всё готово.

Данных гостя здесь нет: ни имён, ни броней, ни самих PIN.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


from apps.core.context import tenant_context
from apps.core.listing import natural_key, sort_rows
from apps.hotels.models import Hotel
from apps.hotels.services import room_numbers

NONE = "none"
CONTROL_ORDER = ("blocked", "attention", "ok", "off")
# Порядок «Что исправить»: сначала то, что мешает всем номерам сразу.
PROBLEMS = ("no_link", "no_variant", "not_published", "no_pin", "demo_entry")
FACETS = ("building", "floor", "category", "variant", "connection", "pin", "control", "problem")

SORTS = {
    "number": ("natural", lambda r: r["number"]),
    "building": ("natural", lambda r: r["building"] or None),
    "floor": ("natural", lambda r: r["floor"] or None),
    "position": ("natural", lambda r: r["position"] or None),
    "category": ("text", lambda r: r["category"] or None),
    "variant": ("text", lambda r: r["variant"]["title"] if r["variant"] else None),
    "connection": ("text", lambda r: r["connection"]["name"] if r["connection"] else None),
    "pin": ("rank", lambda r: "yes" if r["pin"] else "no", ("no", "yes")),
    "control": ("rank", lambda r: r["control"], CONTROL_ORDER),
}


def room_map(hotel: Hotel, params: dict[str, str]) -> dict[str, Any]:
    from apps.grms.models import PublishedConfig, RoomTypeRoom
    from apps.grms.services.access import active_pin_room_ids
    from apps.hotels.models import HotelModule, OnPremNode, Room
    from apps.hotels.services.onprem import GRMS_PURPOSES, link_state

    rule = room_numbers.rule_of(hotel)
    with tenant_context(hotel):
        module = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).first()
        rooms = list(Room.objects.select_related("building", "category").order_by("sort_key", "number"))
        links = {link.room_id: link.room_type for link in RoomTypeRoom.objects.select_related("room_type")}
        published = set(PublishedConfig.objects.filter(is_current=True).values_list("room_type_id", flat=True))
        # «Есть PIN» — то же правило, что у «Доступа» панели (63-1, укус 401).
        pins = active_pin_room_ids()
        link = link_state(list(OnPremNode.objects.filter(purpose__in=GRMS_PURPOSES)))
        # Подключение номера (партия 65): явное назначение либо «по умолчанию».
        # Связь — по коннектору ЭТОГО подключения: у отеля их может быть
        # несколько, и молчание одного не делает «без связи» номера другого.
        from apps.grms.services import links as grms_links

        explicit = grms_links.assignments([room.pk for room in rooms])
        fallback = grms_links.default_server()
        connection_link = {}
        for server in grms_links.servers():
            node = grms_links.node_for_server(server)
            connection_link[str(server.pk)] = "none" if node is None else ("online" if node.is_online else "silent")

    context = {
        "room_control": module is not None,
        "demo_entry": bool(module and (module.config or {}).get("guest_entry_demo") is True),
        "link": link,
        "published": published,
        "explicit": explicit,
        "fallback": fallback,
        "connection_link": connection_link,
    }
    rows = [_row(room, links.get(room.pk), room.pk in pins, rule, context) for room in rooms]

    facets = {key: _facet(rows, key) for key in FACETS}
    search = (params.get("search") or "").strip().lower()
    chosen = {key: [v for v in (params.get(key) or "").split(",") if v] for key in FACETS}
    shown = [row for row in rows if (not search or search in row["number"].lower()) and _passes(row, chosen)]
    ordered = sort_rows(shown, params.get("sort"), params.get("dir"), SORTS, then=lambda r: natural_key(r["number"]))

    return {
        "room_control": context["room_control"],
        "link": link,
        "demo_entry": context["demo_entry"],
        "rule": {**rule, "is_default": room_numbers.is_default(rule)},
        "total": len(rows),
        "found": len(shown),
        # Сводка — по ВСЕМ номерам, а не по отфильтрованным: «Что исправить»
        # не должно худеть оттого, что включён фильтр.
        "summary": {
            "control": {state: sum(1 for r in rows if r["control"] == state) for state in CONTROL_ORDER},
            "problems": {code: sum(1 for r in rows if code in r["problems"]) for code in PROBLEMS},
            "rule_floors": sum(1 for r in rows if r["floor_source"] == "rule"),
            "manual_positions": sum(1 for r in rows if r["position_source"] == "manual"),
        },
        "buildings": _buildings(shown),
        "order": [row["id"] for row in ordered],
        "facets": facets,
    }


def _row(room, room_type, has_pin: bool, rule: dict, context: dict) -> dict[str, Any]:
    place = room_numbers.place_of(room, rule)
    if room.building_id and room.building:
        building_key, building = str(room.building_id), room.building.title_i18n or ""
    elif room.zone:
        building_key, building = f"zone:{room.zone}", room.zone
    else:
        building_key, building = "", ""
    category = room.category.title_i18n if room.category_id and room.category else ""
    variant = {"code": room_type.code, "title": room_type.title_i18n or room_type.code} if room_type else None
    from apps.grms.services import links as grms_links

    connection = grms_links.describe_room(room, explicit_map=context.get("explicit", {}), fallback=context.get("fallback"))
    # Связь номера — по его подключению; подключений нет — по отелю, как раньше.
    room_link = (
        context.get("connection_link", {}).get(connection["id"], context["link"]) if connection else context["link"]
    )

    problems: list[str] = []
    if context["room_control"] and room.is_active:
        if room_link != "online":
            problems.append("no_link")
        if variant is None:
            problems.append("no_variant")
        elif room_type.pk not in context["published"]:
            problems.append("not_published")
        if not has_pin:
            problems.append("demo_entry" if context["demo_entry"] else "no_pin")
    if not context["room_control"] or not room.is_active:
        control = "off"
    elif any(code != "demo_entry" for code in problems):
        control = "blocked"
    elif problems:
        control = "attention"
    else:
        control = "ok"

    return {
        "id": str(room.pk),
        "number": room.number,
        "building_key": building_key,
        "building": building,
        "floor": place.floor,
        "floor_source": place.floor_source,
        "position": place.position,
        "position_source": place.position_source,
        "category": category,
        "variant": variant,
        "connection": connection,
        "pin": has_pin,
        "is_active": room.is_active,
        "control": control,
        "problems": problems,
        "facet": {
            "building": building_key or NONE,
            "floor": place.floor or NONE,
            "category": category or NONE,
            "variant": variant["code"] if variant else NONE,
            "connection": connection["id"] if connection else NONE,
            "pin": "yes" if has_pin else "no",
            "control": control,
        },
    }


def _passes(row: dict, chosen: dict[str, list[str]]) -> bool:
    for key, values in chosen.items():
        if not values:
            continue
        if key == "problem":
            if not any(code in row["problems"] for code in values):
                return False
        elif row["facet"][key] not in values:
            return False
    return True


def _buildings(rows: list[dict]) -> list[dict[str, Any]]:
    """Корпуса → этажи (сверху вниз) → номера по позиции; «без корпуса» и «без этажа» — в конце."""
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = grouped.setdefault(row["building_key"], {"key": row["building_key"], "title": row["building"], "floors": {}, "positions": set()})
        entry["floors"].setdefault(row["floor"], []).append(_public(row))
        if row["position"]:
            entry["positions"].add(row["position"])
    result = []
    for entry in sorted(grouped.values(), key=lambda e: (e["key"] == "", natural_key(e["title"]))):
        # Этажи сверху вниз, как на здании; «без этажа» — в самом низу.
        named = sorted((item for item in entry["floors"].items() if item[0]), key=lambda item: natural_key(item[0]), reverse=True)
        floors = named + [item for item in entry["floors"].items() if not item[0]]
        result.append(
            {
                "key": entry["key"],
                "title": entry["title"],
                "rooms": sum(len(items) for _, items in floors),
                "positions": sorted(entry["positions"], key=natural_key),
                "floors": [
                    {"floor": floor, "rooms": sorted(items, key=lambda r: (natural_key(r["position"]) if r["position"] else (1,), natural_key(r["number"])))}
                    for floor, items in floors
                ],
            }
        )
    return result


def _public(row: dict) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != "facet"}


def _facet(rows: list[dict], key: str) -> list[dict[str, Any]]:
    """Значения фильтра со счётчиками; «не задано» — последним."""
    if key == "problem":
        counts = Counter(code for row in rows for code in row["problems"])
        return [{"value": code, "label": code, "count": counts[code]} for code in PROBLEMS if counts[code]]
    counts = Counter(row["facet"][key] for row in rows)
    labels: dict[str, str] = {}
    if key == "variant":
        labels = {row["variant"]["code"]: row["variant"]["title"] for row in rows if row["variant"]}
    if key == "connection":
        labels = {row["connection"]["id"]: row["connection"]["name"] for row in rows if row["connection"]}
    if key == "building":
        labels = {row["building_key"]: row["building"] for row in rows if row["building_key"]}
    if key == "control":
        return [{"value": state, "label": state, "count": counts[state]} for state in CONTROL_ORDER if counts[state]]
    values = sorted((v for v in counts if v != NONE), key=lambda v: natural_key(labels.get(v, v)))
    if NONE in counts:
        values.append(NONE)
    return [{"value": v, "label": labels.get(v, v), "count": counts[v]} for v in values]
