"""
ВАРИАНТЫ НОМЕРОВ — ПРАВКА ИЗ CONTROL (партия 63-4, шаг B).

Всё, что меняет вариант, — здесь, и каждое изменение пишется в журнал отеля
«было → стало» (`changes`), чтобы «История» отвечала на вопрос «кто сдвинул».

Три правила, ради которых этот модуль вообще отдельный:

* ПРОВЕРКА СМЫСЛА СВЯЗИ. `builder.check_binding` знает форму канала (есть ли
  команда, тот ли вид значения), но не смысл: «свет» на канал шторы проходит
  по форме. Смысл угадывается по именам канала (C_Light…, C_Curtain…) —
  угадывается, поэтому это предупреждение, которое можно осознанно принять,
  а не запрет.
* КОПИЯ ИЗ ДРУГОГО ОТЕЛЯ НЕ ТАЩИТ ЧУЖОЕ. Переносится настройка (каналы, зоны,
  кнопки, разметка), но не номера, не версии и не кадры плана: номера и
  версии — чужие данные, кадр — чужой рендер и чужой ассет.
* УДАЛЕНИЕ НАСТРОЙКИ — НАСТОЯЩЕЕ (`hard=True`). Мягко удалённая кнопка
  продолжала бы держать свой код и свой канал (уникальны в отеле), и канал
  убранной кнопки нельзя было бы отдать новой. История — в журнале «было →
  стало» и в опубликованных версиях, а не в мёртвых строках настройки.
* ДЕЙСТВИЯ НАД НОМЕРАМИ — С ПОДТВЕРЖДЕНИЕМ НА СЕРВЕРЕ. Тестовая команда
  уходит только с повтором «номер, что, значение»; публикация — только с
  числом номеров, которое видел оператор; удалить вариант с номерами нельзя.
"""

from __future__ import annotations

import re

from django.db import transaction

from apps.core.context import tenant_context
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.grms.models import Binding, ControlElement, PublishedConfig, RoomType, RoomTypeRoom, Variable, Zone
from apps.grms.services import builder, catalog
from apps.grms.services import plan as plan_geometry

PLAN_LEVELS = ("tiles", "simple", "full")
LANGS = ("ru", "en", "zh", "ar")

# --- Смысл канала -----------------------------------------------------------

# Порядок важен: «FCU_MainSw» — это кондиционер, а не мастер-выключатель, и
# климат проверяется раньше.
_SUBJECTS: list[tuple[str, tuple[str, ...]]] = [
    ("climate", ("fcu", "setpoint", "temperature", "temp", "кондиц", "climate", "hvac", "fan")),
    ("heating", ("heat", "отоп", "radiator", "floor")),
    ("curtain", ("curtain", "штор", "blind", "jalousie", "blackout", "блэкаут", "shade")),
    ("light", ("light", "свет", "lamp", "dimmer", "dali")),
    ("dnd", ("dnd", "disturb", "беспоко")),
    ("mur", ("mur", "makeup", "make_up", "clean", "уборк")),
    ("scene", ("scene", "сцен")),
    ("master", ("master", "alloff", "all_off", "mainsw", "мастер")),
]

KIND_SUBJECTS: dict[str, set[str]] = {
    "light_group": {"light"},
    "curtain": {"curtain"},
    "curtain_blackout": {"curtain"},
    "air_conditioner": {"climate"},
    "heating": {"heating", "climate"},
    "dnd": {"dnd"},
    "mur": {"mur"},
    "scene": {"scene"},
    "master_switch": {"master", "scene"},
}


def subjects_of(variable: Variable) -> set[str]:
    """О чём канал, по его именам. Пусто — понять нельзя, и это не ошибка."""
    text = " ".join([variable.key, variable.command, variable.feedback, variable.description]).lower()
    for subject, marks in _SUBJECTS:
        if any(mark in text for mark in marks):
            return {subject}
    return set()


def sense(kind: str, variable: Variable) -> dict | None:
    """Предупреждение о смысле связи или None. Код и данные — слова на экране."""
    expected = KIND_SUBJECTS.get(kind, set())
    found = subjects_of(variable)
    if expected and found and not (expected & found):
        return {"code": "subject_mismatch", "expected": sorted(expected)[0], "found": sorted(found)[0]}
    return None


def suggestions(hotel, code: str, slug: str, capability: str) -> list[dict]:
    """
    Каналы для связи «кнопка — возможность», подходящие сверху.

    Подходит — форма совпадает (`check_binding`), смысл совпадает и канал ещё
    ни к чему не привязан. Неподходящие тоже в списке, но ниже и с причиной:
    инженер видит, почему, а не гадает, куда делся канал.
    """
    with tenant_context(hotel):
        room_type = builder._type(code)
        element = ControlElement.objects.filter(room_type=room_type, slug=slug).first()
        if element is None:
            raise NotFoundError("Кнопка не найдена")
        _check_capability(element.kind, capability)
        # Один канал — одна кнопка (ограничение базы): занятый канал не
        # выбрать, но видно, у какой кнопки он сейчас.
        used = {
            b.variable_id: (b.element.slug, (b.element.title or {}).get("ru") or catalog.ELEMENTS[b.element.kind].title_ru)
            for b in Binding.objects.filter(element__room_type=room_type).select_related("element")
        }
        rows = []
        for variable in Variable.objects.filter(room_type=room_type).order_by("key"):
            form = builder.check_binding(capability, variable)
            warn = sense(element.kind, variable)
            holder = used.get(variable.pk)
            taken = holder[1] if holder and holder[0] != slug else None
            fit = "bad" if (form or taken) else "warn" if warn else "good"
            if fit == "good" and not (KIND_SUBJECTS.get(element.kind, set()) & subjects_of(variable)):
                fit = "ok"  # форма подходит, смысл по именам не понять
            rows.append(
                {
                    "key": variable.key,
                    "command": variable.command,
                    "feedback": variable.feedback,
                    "range": [variable.min_value, variable.max_value],
                    "value_kind": variable.value_kind,
                    "fit": fit,
                    "form": form,
                    "sense": warn,
                    "taken_by": taken,
                }
            )
    order = {"good": 0, "ok": 1, "warn": 2, "bad": 3}
    # Внутри «проверьте» — сначала свой по смыслу (просто занятый), потом чужой.
    return sorted(rows, key=lambda r: (order[r["fit"]], bool(r["sense"]), r["key"]))


def _check_capability(kind: str, capability: str) -> None:
    if capability not in catalog.ELEMENTS[kind].capabilities:
        raise ValidationError("У этой кнопки нет такой возможности", field="capability", code="no_such_ability")


# --- Журнал -----------------------------------------------------------------


def _audit(hotel, action: str, actor_id, code: str, *, changes: dict | None = None, title: str | None = None, **payload) -> None:
    from apps.hotels.services.platform import console

    if title is None:
        # Название варианта — в запись: журнал показывает его, а не код.
        with tenant_context(hotel):
            row = RoomType.all_objects.filter(code=code).values_list("title", flat=True).first()
        title = (row or {}).get("ru") or ""
    body = {"type": code, "type_title": title, **payload}
    if changes:
        body["changes"] = changes
    console.audit_hotel(hotel, action, actor_id=actor_id, payload=body)


def _diff(before: dict, after: dict) -> dict:
    return {k: {"from": before.get(k), "to": after.get(k)} for k in after if before.get(k) != after.get(k)}


def _title_words(title: dict) -> dict:
    return {f"title_{lang}": (title or {}).get(lang) or "" for lang in LANGS if (title or {}).get(lang)}


def _clean_title(raw: dict | None, *, field: str = "title") -> dict:
    title = {lang: str(v).strip()[:120] for lang, v in (raw or {}).items() if lang in LANGS and str(v or "").strip()}
    if not title:
        raise ValidationError("Нужно название", field=field, code="title_required")
    return title


# --- Вариант: завести, основа, удалить ----------------------------------------


def _new_code(title: dict) -> str:
    base = builder._slug(title.get("ru") or next(iter(title.values()), "variant"))[:48] or "variant"
    code, n = base, 2
    # all_objects: мягко удалённые прежде строки тоже держат код.
    while RoomType.all_objects.filter(code=code).exists():
        code, n = f"{base}-{n}", n + 1
    return code


def create(hotel, *, title: dict, plan_level: str = "tiles", notes: str = "", source: str = "", source_hotel: str = "", actor_id=None) -> dict:
    """Новый вариант: с нуля или копией варианта этого или другого отеля."""
    title = _clean_title(title)
    if plan_level not in PLAN_LEVELS:
        raise ValidationError("Неизвестный вид экрана", field="plan_level")
    donor = None
    if source:
        donor = _read_donor(hotel, source, source_hotel)
    with tenant_context(hotel), transaction.atomic():
        code = _new_code(title)
        room_type = RoomType.objects.create(
            code=code,
            title=title,
            plan_level=donor["plan_level"] if donor else plan_level,
            notes=(notes or (donor["notes"] if donor else ""))[:2000],
            device_name_template=donor["device_name_template"] if donor else "",
            subdevice=donor["subdevice"] if donor else "",
            plan=donor["plan"] if donor else {},
        )
        if donor:
            _paste(room_type, donor)
    _audit(
        hotel,
        "grms.variant_created",
        actor_id,
        code,
        changes={"variant": {"from": None, "to": title.get("ru") or next(iter(title.values()))}},
        source=("copy_other" if source_hotel else "copy") if donor else "blank",
        **({"from_type": source} if donor else {}),
    )
    return {"code": code}


def _read_donor(hotel, source: str, source_hotel: str) -> dict:
    """
    Настройка варианта-источника — словарём, без ссылок на чужие строки.

    Номера, версии и кадры плана не читаются вовсе: копия из другого отеля не
    должна унести ни одного чужого номера (укус партии), а кадр — ассет чужого
    отеля, под RLS этого отеля его не прочесть.
    """
    from apps.hotels.models import Hotel

    other = hotel
    if source_hotel and str(source_hotel) != str(hotel.pk):
        other = Hotel.objects.filter(pk=source_hotel).first()
        if other is None:
            raise NotFoundError("Отель-источник не найден")
    with tenant_context(other):
        src = RoomType.objects.filter(code=source).first()
        if src is None:
            raise NotFoundError("Вариант-источник не найден")
        zones = list(Zone.objects.filter(room_type=src).values("code", "title", "sort_order", "icon"))
        variables = list(
            Variable.objects.filter(room_type=src).values(
                "key", "command", "feedback", "value_kind", "min_value", "max_value", "raw_range", "description"
            )
        )
        elements = []
        for el in ControlElement.objects.filter(room_type=src).select_related("zone").order_by("sort_order", "slug"):
            elements.append(
                {
                    "slug": el.slug,
                    "kind": el.kind,
                    "title": el.title,
                    "zone": el.zone.code if el.zone else "",
                    "sort_order": el.sort_order,
                    "icon": el.icon,
                    "hint": el.hint,
                    "bindings": [
                        {"capability": b.capability, "variable": b.variable.key, "trigger_value": b.trigger_value}
                        for b in Binding.objects.filter(element=el).select_related("variable")
                    ],
                }
            )
        plan = {k: v for k, v in (src.plan or {}).items() if k not in ("asset_id", "asset_off_id", "off_source")}
        return {
            "plan_level": src.plan_level,
            "notes": src.notes,
            "device_name_template": src.device_name_template,
            "subdevice": src.subdevice,
            "plan": plan,
            "zones": zones,
            "variables": variables,
            "elements": elements,
        }


def _paste(room_type: RoomType, donor: dict) -> None:
    zones = {z["code"]: Zone.objects.create(room_type=room_type, **z) for z in donor["zones"]}
    variables = {v["key"]: Variable.objects.create(room_type=room_type, **v) for v in donor["variables"]}
    for el in donor["elements"]:
        element = ControlElement.objects.create(
            room_type=room_type,
            slug=el["slug"],
            kind=el["kind"],
            title=el["title"],
            zone=zones.get(el["zone"]),
            sort_order=el["sort_order"],
            icon=el["icon"],
            hint=el["hint"],
        )
        for b in el["bindings"]:
            if b["variable"] in variables:
                Binding.objects.create(element=element, capability=b["capability"], variable=variables[b["variable"]], trigger_value=b["trigger_value"])


def update_base(hotel, code: str, *, title: dict, notes: str, plan_level: str, device_name_template: str | None = None, actor_id=None) -> None:
    title = _clean_title(title)
    if plan_level not in PLAN_LEVELS:
        raise ValidationError("Неизвестный вид экрана", field="plan_level")
    with tenant_context(hotel):
        room_type = builder._type(code)
        before = {**_title_words(room_type.title), "notes": room_type.notes, "plan_level": room_type.plan_level, "device_template": room_type.device_name_template}
        room_type.title = title
        room_type.notes = (notes or "")[:2000]
        room_type.plan_level = plan_level
        if device_name_template is not None:
            # Единственная подстановка — {room}; без неё все номера получили бы
            # одно устройство, то есть команды не в тот номер.
            template = device_name_template.strip()[:255]
            if template and "{room}" not in template:
                raise ValidationError("В имени устройства нужен номер: {room}", field="device_name_template", code="device_template_no_room")
            room_type.device_name_template = template
        room_type.save(update_fields=["title", "notes", "plan_level", "device_name_template", "updated_at"])
    after = {**_title_words(title), "notes": room_type.notes, "plan_level": plan_level, "device_template": room_type.device_name_template}
    # Снятое название на языке — тоже правка: «было → (пусто)».
    for lang in LANGS:
        if before.get(f"title_{lang}") and f"title_{lang}" not in after:
            after[f"title_{lang}"] = ""
    changes = _diff(before, after)
    if changes:
        _audit(hotel, "grms.variant_updated", actor_id, code, changes=changes)


def delete(hotel, code: str, *, actor_id=None) -> None:
    """Удалить можно только вариант без номеров — иначе сказать, сколько и куда деть."""
    with tenant_context(hotel):
        room_type = builder._type(code)
        rooms = RoomTypeRoom.objects.filter(room_type=room_type).count()
        if rooms:
            raise ConflictError(
                f"У варианта {rooms} номеров — сначала назначьте им другой вариант или снимите вариант",
                code="variant_has_rooms",
                rooms=rooms,
            )
        title = room_type.title
        room_type.delete(hard=True)
    _audit(hotel, "grms.variant_deleted", actor_id, code, title=(title or {}).get("ru") or "", changes={"variant": {"from": (title or {}).get("ru") or code, "to": None}})


# --- Зоны -------------------------------------------------------------------


def zone_add(hotel, code: str, *, title: dict, actor_id=None) -> dict:
    title = _clean_title(title)
    with tenant_context(hotel):
        room_type = builder._type(code)
        base = builder._slug(title.get("ru") or next(iter(title.values())))[:40] or "zone"
        zone_code, n = base, 2
        while Zone.all_objects.filter(room_type=room_type, code=zone_code).exists():
            zone_code, n = f"{base}-{n}", n + 1
        last = Zone.objects.filter(room_type=room_type).order_by("-sort_order").first()
        Zone.objects.create(room_type=room_type, code=zone_code, title=title, sort_order=(last.sort_order + 1) if last else 0)
    _audit(hotel, "grms.zone_added", actor_id, code, changes={"zone": {"from": None, "to": title.get("ru") or zone_code}})
    return {"code": zone_code}


def zone_update(hotel, code: str, zone_code: str, *, title: dict, actor_id=None) -> None:
    title = _clean_title(title)
    with tenant_context(hotel):
        zone = _zone(code, zone_code)
        before = (zone.title or {}).get("ru") or ""
        zone.title = title
        zone.save(update_fields=["title", "updated_at"])
    if before != title.get("ru", ""):
        _audit(hotel, "grms.zone_updated", actor_id, code, changes={"zone_title": {"from": before, "to": title.get("ru", "")}})


def zone_delete(hotel, code: str, zone_code: str, *, actor_id=None) -> dict:
    """
    Убрать зону. Кнопки зоны не удаляются — переходят в «Без зоны»: потерять
    связь с оборудованием из-за переименования комнаты — слишком дорого. С
    плана зона уходит вместе с разметкой.
    """
    with tenant_context(hotel):
        zone = _zone(code, zone_code)
        moved = ControlElement.objects.filter(zone=zone).update(zone=None)
        title = (zone.title or {}).get("ru") or zone_code
        zone.delete(hard=True)
        room_type = builder._type(code)
        plan_geometry.edit(room_type, lambda plan: plan.update({"zones": [z for z in plan.get("zones") or [] if z.get("code") != zone_code]}))
    _audit(hotel, "grms.zone_removed", actor_id, code, changes={"zone": {"from": title, "to": None}}, moved_buttons=moved)
    return {"moved": moved}


def zones_order(hotel, code: str, *, zones: list[str], actor_id=None) -> None:
    with tenant_context(hotel):
        room_type = builder._type(code)
        known = {z.code: z for z in Zone.objects.filter(room_type=room_type)}
        before = [z.code for z in sorted(known.values(), key=lambda z: (z.sort_order, z.code))]
        for i, zone_code in enumerate(zones):
            if zone_code in known:
                Zone.objects.filter(pk=known[zone_code].pk).update(sort_order=i)
    if before != zones:
        _audit(hotel, "grms.zones_ordered", actor_id, code, changes={"zone_order": {"from": ", ".join(before), "to": ", ".join(zones)}})


def _zone(code: str, zone_code: str) -> Zone:
    zone = Zone.objects.filter(room_type__code=code, code=zone_code).first()
    if zone is None:
        raise NotFoundError("Зона не найдена")
    return zone


# --- Кнопки -----------------------------------------------------------------


def element_add(hotel, code: str, *, kind: str, zone_code: str = "", title: dict | None = None, actor_id=None) -> dict:
    if kind not in catalog.ELEMENTS:
        raise ValidationError("Неизвестный вид кнопки", field="kind", code="unknown_kind")
    title = {lang: str(v).strip()[:120] for lang, v in (title or {}).items() if lang in LANGS and str(v or "").strip()}
    with tenant_context(hotel):
        room_type = builder._type(code)
        prefix = {"light_group": "light", "air_conditioner": "ac", "curtain_blackout": "blackout", "master_switch": "master"}.get(kind, kind)
        slug, n = f"{prefix}.{zone_code or 'room'}"[:60], 2
        slug = re.sub(r"[^a-z0-9._-]", "-", slug)
        base = slug
        while ControlElement.all_objects.filter(room_type=room_type, slug=slug).exists():
            slug, n = f"{base}-{n}", n + 1
        last = ControlElement.objects.filter(room_type=room_type).order_by("-sort_order").first()
    element = builder.add_element(
        hotel, room_type_code=code, kind=kind, slug=slug, zone_code=zone_code, title=title,
        sort_order=(last.sort_order + 1) if last else 0,
    )
    if kind == "light_group" and zone_code:
        # Касание зоны на плане включает её свет: область своей зоны, оставшаяся
        # без кнопки, достаётся новой кнопке света сама — иначе публикация
        # споткнётся о «зону без рабочего элемента».
        with tenant_context(hotel):
            room_type = builder._type(code)
            alive = set(ControlElement.objects.filter(room_type=room_type).values_list("slug", flat=True))
            if any(z.get("code") == zone_code and z.get("controlId") not in alive for z in (room_type.plan or {}).get("zones") or []):
                plan_geometry.edit(
                    room_type,
                    lambda plan: plan.update({"zones": [{**z, "controlId": element.slug} if z.get("code") == zone_code and z.get("controlId") not in alive else z for z in plan.get("zones") or []]}),
                )
    _audit(hotel, "grms.element_added", actor_id, code, element=element.slug, changes={"button": {"from": None, "to": title.get("ru") or catalog.ELEMENTS[kind].title_ru}})
    return {"slug": element.slug}


def element_update(hotel, code: str, slug: str, *, title: dict | None, zone_code: str, actor_id=None) -> None:
    title = {lang: str(v).strip()[:120] for lang, v in (title or {}).items() if lang in LANGS and str(v or "").strip()}
    with tenant_context(hotel):
        element = _element(code, slug)
        zone = None
        if zone_code:
            zone = Zone.objects.filter(room_type=element.room_type, code=zone_code).first()
            if zone is None:
                raise NotFoundError("Зона не найдена")
        before = {"button_title": (element.title or {}).get("ru") or "", "button_zone": _zone_word(element.zone)}
        element.title = title
        element.zone = zone
        element.save(update_fields=["title", "zone", "updated_at"])
        after = {"button_title": title.get("ru") or "", "button_zone": _zone_word(zone)}
    changes = _diff(before, after)
    if changes:
        _audit(hotel, "grms.element_updated", actor_id, code, element=slug, changes=changes)


def _zone_word(zone: Zone | None) -> str:
    return ((zone.title or {}).get("ru") or zone.code) if zone else ""


def element_delete(hotel, code: str, slug: str, *, actor_id=None) -> None:
    """Убрать кнопку — и все ссылки на неё с плана, чтобы публикация не споткнулась о «висящие»."""
    with tenant_context(hotel):
        element = _element(code, slug)
        title = (element.title or {}).get("ru") or catalog.ELEMENTS[element.kind].title_ru
        room_type = element.room_type
        heir = (
            ControlElement.objects.filter(room_type=room_type, zone=element.zone, kind="light_group").exclude(pk=element.pk).order_by("sort_order").first()
            if element.zone and element.kind == "light_group"
            else None
        )
        Binding.all_objects.filter(element=element).hard_delete()
        element.delete(hard=True)

        def strip(plan: dict) -> None:
            plan["points"] = [p for p in plan.get("points") or [] if p.get("controlId") != slug]
            # Область зоны — другой кнопке света этой зоны; нет такой — пусто,
            # и шаг «План» скажет, что зону надо привязать.
            plan["zones"] = [{**z, "controlId": heir.slug if heir else None} if z.get("controlId") == slug else z for z in plan.get("zones") or []]
            plan["windows"] = [
                {**w, **({"curtainId": None} if w.get("curtainId") == slug else {}), **({"blackoutId": None} if w.get("blackoutId") == slug else {})}
                for w in plan.get("windows") or []
            ]

        if room_type.plan:
            plan_geometry.edit(room_type, strip)
    _audit(hotel, "grms.element_removed", actor_id, code, element=slug, changes={"button": {"from": title, "to": None}})


def elements_order(hotel, code: str, *, slugs: list[str], actor_id=None) -> None:
    with tenant_context(hotel):
        room_type = builder._type(code)
        known = {e.slug: e for e in ControlElement.objects.filter(room_type=room_type)}
        before = [e.slug for e in sorted(known.values(), key=lambda e: (e.sort_order, e.slug))]
        for i, slug in enumerate(slugs):
            if slug in known:
                ControlElement.objects.filter(pk=known[slug].pk).update(sort_order=i)
        words = {s: (known[s].title or {}).get("ru") or catalog.ELEMENTS[known[s].kind].title_ru for s in known}
    if before != slugs:
        _audit(
            hotel, "grms.elements_ordered", actor_id, code,
            changes={"button_order": {"from": ", ".join(words.get(s, s) for s in before), "to": ", ".join(words.get(s, s) for s in slugs if s in words)}},
        )


def _element(code: str, slug: str) -> ControlElement:
    element = ControlElement.objects.filter(room_type__code=code, slug=slug).select_related("zone", "room_type").first()
    if element is None:
        raise NotFoundError("Кнопка не найдена")
    return element


# --- Связь с оборудованием -----------------------------------------------------


def link(hotel, code: str, slug: str, *, capability: str, variable_key: str, accept_warning: bool = False, actor_id=None) -> dict:
    """
    Связать возможность кнопки с каналом. Форма проверяется жёстко
    (`builder.bind`), смысл — предупреждением: без `accept_warning` сервер
    отвечает 409 и говорит, что не так («свет на канал шторы»).
    """
    with tenant_context(hotel):
        element = _element(code, slug)
        _check_capability(element.kind, capability)
        variable = Variable.objects.filter(room_type=element.room_type, key=variable_key).first()
        if variable is None:
            raise NotFoundError("Канал не найден")
        warn = sense(element.kind, variable)
        holder = Binding.objects.filter(variable=variable).exclude(element=element).select_related("element").first()
        if holder is not None:
            name = (holder.element.title or {}).get("ru") or catalog.ELEMENTS[holder.element.kind].title_ru
            raise ConflictError(f"Канал уже у кнопки «{name}»", code="channel_taken", button=name)
        old = Binding.objects.filter(element=element, capability=capability).select_related("variable").first()
        before = old.variable.key if old else None
    if warn and not accept_warning:
        raise ConflictError("Канал, похоже, не для этой кнопки", code="binding_sense_warning", sense=warn)
    builder.bind(hotel, element_slug=slug, room_type_code=code, capability=capability, variable_key=variable_key)
    if before != variable_key:
        _audit(
            hotel, "grms.binding_set", actor_id, code, element=slug, capability=capability,
            changes={f"binding:{capability}": {"from": before, "to": variable_key}},
            **({"accepted_warning": True} if warn else {}),
        )
    return {"sense": warn}


def unlink(hotel, code: str, slug: str, *, capability: str, actor_id=None) -> None:
    with tenant_context(hotel):
        element = _element(code, slug)
        old = Binding.objects.filter(element=element, capability=capability).select_related("variable").first()
        if old is None:
            return
        key = old.variable.key
        old.delete(hard=True)
    _audit(hotel, "grms.binding_removed", actor_id, code, element=slug, capability=capability, changes={f"binding:{capability}": {"from": key, "to": None}})


def buttons(hotel, code: str) -> list[dict]:
    """Кнопки варианта с тем, чего не хватает, — кодами для экрана, без русских фраз builder'а."""
    with tenant_context(hotel):
        room_type = builder._type(code)
        out = []
        for el in ControlElement.objects.filter(room_type=room_type).select_related("zone").order_by("sort_order", "slug"):
            kind = catalog.ELEMENTS[el.kind]
            bound = {b.capability: b for b in Binding.objects.filter(element=el).select_related("variable")}
            abilities = []
            for cap in kind.capabilities:
                b = bound.get(cap)
                abilities.append(
                    {
                        "capability": cap,
                        "required": cap in kind.required,
                        "variable": b.variable.key if b else None,
                        "command": b.variable.command if b else "",
                        "feedback": b.variable.feedback if b else "",
                        "form": builder.check_binding(cap, b.variable) if b else "",
                        "sense": sense(el.kind, b.variable) if b else None,
                    }
                )
            missing = [a["capability"] for a in abilities if a["required"] and not a["variable"]]
            out.append(
                {
                    "slug": el.slug,
                    "kind": el.kind,
                    "title": el.title or {},
                    "zone": el.zone.code if el.zone else "",
                    "sort_order": el.sort_order,
                    "abilities": abilities,
                    "missing": missing,
                    "publishable": not missing and not any(a["form"] for a in abilities),
                    "warnings": sum(1 for a in abilities if a["sense"]),
                }
            )
    return out


# --- Номер: тестовая команда, публикация, откат ------------------------------


def test_command(hotel, code: str, *, slug: str, room_number: str, capability: str, value: int, confirm: dict | None) -> dict:
    """
    Тестовая команда в номер — только с подтверждением: номер, кнопка и
    значение, которые оператор видел в окне, должны совпасть с отправляемыми.
    Без этого команда не уходит (укус партии).
    """
    from apps.grms.services import roomcheck

    confirm = confirm or {}
    if (
        str(confirm.get("room") or "") != str(room_number)
        or str(confirm.get("element") or "") != slug
        or confirm.get("value") != value
    ):
        raise ValidationError("Подтвердите номер, кнопку и значение", field="confirm", code="test_needs_confirm")
    return roomcheck.check_element(hotel, room_type_code=code, element_slug=slug, room_number=room_number, capability=capability, value=value)


def publish(hotel, code: str, *, rooms: int, actor_id=None) -> dict:
    """
    Опубликовать — только если номеров у варианта столько, сколько видел
    оператор в окне подтверждения. Иначе 409: пока он читал, номера
    переназначили, и «изменится у N» уже неправда.
    """
    from apps.core.models import AuditLog
    from apps.grms.services import publishing

    with tenant_context(hotel):
        actual = RoomTypeRoom.objects.filter(room_type__code=code, room__is_active=True).count()
    if actual != rooms:
        raise ConflictError("Число номеров варианта изменилось — откройте подтверждение заново", code="publish_rooms_changed", rooms=actual)
    _check_plan(hotel, code)
    config = publishing.publish(hotel, code, actor_type=AuditLog.ActorType.PLATFORM, actor_id=actor_id, extra={"rooms": actual})
    return {"version": config.version, "rooms": actual}


def _check_plan(hotel, code: str) -> None:
    """
    Та же проверка разметки, что в `publishing.publish`, но с названиями зон
    вместо кодов: оператор должен понять, какую зону привязать.
    """
    from apps.grms.services import publishing

    snapshot = publishing.build_snapshot(hotel, code)
    ids = {c["controlId"] for z in snapshot["zones"] for c in z["controls"]}
    with tenant_context(hotel):
        room_type = builder._type(code)
        broken = plan_geometry.dangling(room_type.plan, control_ids=ids)
        titles = {z.code: (z.title or {}).get("ru") or z.code for z in Zone.objects.filter(room_type=room_type)}
    zones = sorted({titles.get(b["code"], b["code"]) for b in broken if b["kind"] == "zone"})
    if zones:
        raise ValidationError("На плане зоны без кнопки: " + ", ".join(zones), field="plan", code="plan_zone_unbound", zones=", ".join(zones))
    if broken:
        raise ValidationError("На плане точки или окна ссылаются на убранные кнопки", field="plan", code="plan_refs_broken")


def rollback(hotel, code: str, *, to_version: int, confirm: bool, actor_id=None) -> dict:
    from apps.core.models import AuditLog
    from apps.grms.services import publishing

    if not confirm:
        raise ValidationError("Подтвердите откат", field="confirm", code="rollback_needs_confirm")
    with tenant_context(hotel):
        rooms = RoomTypeRoom.objects.filter(room_type__code=code, room__is_active=True).count()
        if not PublishedConfig.objects.filter(room_type__code=code, version=to_version).exists():
            raise NotFoundError("Такой версии нет")
    config = publishing.rollback(hotel, code, to_version=to_version, actor_type=AuditLog.ActorType.PLATFORM, actor_id=actor_id)
    return {"version": config.version, "rooms": rooms}


# --- Источники копии -----------------------------------------------------------


def copy_sources(hotel) -> list[dict]:
    """Варианты других отелей с модулем — для «копия из другого отеля». Без номеров."""
    from apps.hotels.models import Hotel, HotelModule

    out = []
    for other in Hotel.objects.exclude(pk=hotel.pk).order_by("name"):
        with tenant_context(other):
            if not HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists():
                continue
            types = [
                {"code": t.code, "title": t.title or {}, "buttons": ControlElement.objects.filter(room_type=t).count()}
                for t in RoomType.objects.order_by("code")
            ]
        if types:
            # Название отеля бывает многоязычным — для списка нужна строка.
            name = other.name if isinstance(other.name, str) else ((other.name or {}).get("ru") or next(iter((other.name or {}).values()), "") or other.subdomain)
            out.append({"hotel_id": str(other.pk), "hotel": name, "variants": types})
    return out
