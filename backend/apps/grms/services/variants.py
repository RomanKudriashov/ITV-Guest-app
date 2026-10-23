"""
ВАРИАНТЫ НОМЕРОВ — СВОДКА ДЛЯ CONTROL (партия 63-4, шаг A: только чтение).

Вариант номера (в коде — `RoomType`) — одна настройка: план, зоны, кнопки для
гостя, каналы оборудования. Применяется сразу ко многим одинаковым номерам.

Здесь ничего не пишется: сводка собирается из того, что уже лежит в черновике
и в опубликованных снимках. «Есть неопубликованные правки» — не флаг, который
можно забыть сбросить, а сравнение черновика (`build_snapshot`, тот же снимок,
что уехал бы гостю при публикации) с текущей версией.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.grms.models import ControlElement, PublishedConfig, RoomType, RoomTypeRoom
from apps.grms.services import builder, plan, publishing

# Состояния варианта — коды для экрана, слова подбирает Control.
PUBLISHED = "published"  # черновик совпадает с текущей версией
CHANGED = "changed"  # есть неопубликованные правки
UNPUBLISHED = "unpublished"  # настроен, но ни разу не публиковался
EMPTY = "empty"  # не настроен: ни одной кнопки


def overview(hotel) -> dict:
    """Все варианты отеля с числами для карточек и обзора-пути."""
    from apps.hotels.models import Room

    with tenant_context(hotel):
        types = list(RoomType.objects.order_by("code"))
        rooms_total = Room.objects.filter(is_active=True).count()
        bound = dict.fromkeys((t.pk for t in types), 0)
        room_ids: dict = {t.pk: [] for t in types}
        for link in RoomTypeRoom.objects.filter(room__is_active=True).values("room_type_id", "room_id"):
            bound[link["room_type_id"]] = bound.get(link["room_type_id"], 0) + 1
            room_ids.setdefault(link["room_type_id"], []).append(str(link["room_id"]))
        current = {
            c.room_type_id: c
            for c in PublishedConfig.objects.filter(is_current=True, room_type__in=types)
        }
        imported = (
            AuditLog.objects.filter(hotel_id=hotel.pk, action="grms.import_confirmed")
            .order_by("-created_at")
            .values("created_at", "payload")
            .first()
        )
        elements = {}
        for row in ControlElement.objects.filter(room_type__in=types).values("room_type_id"):
            elements[row["room_type_id"]] = elements.get(row["room_type_id"], 0) + 1
        # Кадры — ассеты отеля: читаются под RLS, поэтому внутри контекста.
        thumbs = {t.pk: _thumb(t.plan) for t in types}

    variants = []
    for room_type in types:
        status = builder.type_status(hotel, room_type.code)
        live = current.get(room_type.pk)
        state = _state(hotel, room_type, live, elements.get(room_type.pk, 0))
        variants.append(
            {
                "code": room_type.code,
                "title": room_type.title or {},
                "notes": room_type.notes or "",
                "plan_level": room_type.plan_level,
                "thumb": thumbs.get(room_type.pk),
                "rooms": bound.get(room_type.pk, 0),
                "room_ids": room_ids.get(room_type.pk, []),
                "state": state,
                "elements": elements.get(room_type.pk, 0),
                "publishable": len(status["publishable"]),
                "hidden": len(status["hidden"]),
                "zones": len(status["zones"]),
                "version": live.version if live else None,
                "published_at": live.published_at.isoformat() if live and live.published_at else None,
                "has_plan": bool(room_type.plan),
                "device_template": room_type.device_name_template or "",
            }
        )

    with_variant = sum(v["rooms"] for v in variants)
    return {
        "variants": variants,
        "rooms": {"total": rooms_total, "with_variant": with_variant},
        "published": sum(1 for v in variants if v["state"] in (PUBLISHED, CHANGED)),
        "changed": sum(1 for v in variants if v["state"] == CHANGED),
        # Откуда пришла настройка: последний подтверждённый импорт файла
        # пусконаладки. Имя файла журнал начнёт хранить с шага B; до того — дата.
        "origin": (
            {
                "kind": "import",
                "at": imported["created_at"].isoformat(),
                "file": str((imported["payload"] or {}).get("file") or ""),
            }
            if imported
            else {"kind": "manual", "at": None, "file": ""}
        ),
    }


def _state(hotel, room_type, live, elements: int) -> str:
    if live is None:
        return EMPTY if not elements else UNPUBLISHED
    draft = publishing.build_snapshot(hotel, room_type.code)
    return PUBLISHED if _same(draft, live.payload or {}) else CHANGED


def _thumb(raw: object) -> str | None:
    """Миниатюра плана — кадр «свет включён»; нет плана — нет миниатюры."""
    if not isinstance(raw, dict) or not raw.get("asset_id"):
        return None
    with_frame = plan.frame_payload(str(raw["asset_id"]))
    return (with_frame or {}).get("url") or None


def _same(a: dict, b: dict) -> bool:
    return _comparable(a) == _comparable(b)


def _comparable(snapshot: dict) -> dict:
    # Сравнивается то, что видит гость и что уходит оборудованию; служебные
    # поля снимка (время, кто публиковал) в нём не лежат.
    return {
        "title": snapshot.get("title") or {},
        "device_name_template": snapshot.get("device_name_template") or "",
        "subdevice": snapshot.get("subdevice") or "",
        "zones": snapshot.get("zones") or [],
        "plan": snapshot.get("plan") or {},
    }


def diff(hotel, code: str) -> dict:
    """
    «Что изменится» при публикации: черновик против текущей версии.

    Список изменений — кодами и данными (название зоны, кнопки), слова — на
    экране. Номера, которых это коснётся, — все номера варианта.
    """
    with tenant_context(hotel):
        room_type = builder._type(code)
        live = PublishedConfig.objects.filter(room_type=room_type, is_current=True).first()
        rooms = RoomTypeRoom.objects.filter(room_type=room_type, room__is_active=True).count()
    draft = publishing.build_snapshot(hotel, code)
    before = (live.payload or {}) if live else {}
    changes: list[dict] = []

    if (draft.get("title") or {}) != (before.get("title") or {}):
        changes.append({"what": "title", "from": before.get("title") or {}, "to": draft.get("title") or {}})

    old_zones = {z.get("code", ""): z for z in before.get("zones") or []}
    new_zones = {z.get("code", ""): z for z in draft.get("zones") or []}
    for zone_code in new_zones.keys() - old_zones.keys():
        changes.append({"what": "zone_added", "zone": new_zones[zone_code].get("title") or {}, "code": zone_code})
    for zone_code in old_zones.keys() - new_zones.keys():
        changes.append({"what": "zone_removed", "zone": old_zones[zone_code].get("title") or {}, "code": zone_code})

    old_controls = _controls(before)
    new_controls = _controls(draft)
    for cid in sorted(new_controls.keys() - old_controls.keys()):
        changes.append({"what": "control_added", **_brief(new_controls[cid])})
    for cid in sorted(old_controls.keys() - new_controls.keys()):
        changes.append({"what": "control_removed", **_brief(old_controls[cid])})
    for cid in sorted(new_controls.keys() & old_controls.keys()):
        a, b = old_controls[cid], new_controls[cid]
        fields = [
            name
            for name, key in (("title", "title"), ("abilities", "capabilities"), ("channels", "channels"), ("zone", "_zone"), ("range", "range"))
            if (a.get(key) or None) != (b.get(key) or None)
        ]
        if fields:
            changes.append({"what": "control_changed", "fields": fields, **_brief(b)})

    old_plan, new_plan = before.get("plan") or {}, draft.get("plan") or {}
    if old_plan.get("level") != new_plan.get("level") and (old_plan or new_plan):
        changes.append({"what": "plan_level", "from": old_plan.get("level") or "", "to": new_plan.get("level") or ""})
    strip = lambda p: {k: v for k, v in p.items() if k != "level"}  # noqa: E731
    if strip(old_plan) != strip(new_plan):
        changes.append({"what": "plan"})

    return {
        "code": code,
        "current": live.version if live else None,
        "rooms": rooms,
        "same": not changes,
        "changes": changes,
    }


def _controls(snapshot: dict) -> dict[str, dict]:
    out = {}
    for zone in snapshot.get("zones") or []:
        for control in zone.get("controls") or []:
            cid = control.get("controlId")
            if cid:
                out[cid] = {**control, "_zone": zone.get("code", ""), "_zone_title": zone.get("title") or {}}
    return out


def _brief(control: dict) -> dict:
    return {
        "control": control.get("controlId", ""),
        "kind": control.get("kind", ""),
        "title": control.get("title") or {},
        "zone": control.get("_zone_title") or {},
    }
