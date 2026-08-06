"""
Публикация конфигурации типа: версии и откат.

Гость видит ТОЛЬКО опубликованную версию. Правки в конструкторе на живой номер
не влияют, пока не нажата публикация, — иначе половина настройки уезжала бы
гостю в тот момент, когда администратор ещё думает.

Опубликованная версия — САМОДОСТАТОЧНЫЙ СНИМОК: зоны, элементы, порядок,
маппинг, диапазоны, шаблон устройства, имена каналов. Она не ссылается на
текущие переменные и элементы, а содержит их копию.

Иначе удаление переменной в черновике молча сломало бы работающую
опубликованную конфигурацию, а откат к v2 означал бы «v2 плюс сегодняшние
правки справочников» — то есть не откат.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.grms import builder, catalog
from apps.grms import plan as plan_geometry
from apps.grms.models import Binding, ControlElement, PublishedConfig, RoomType


def build_snapshot(hotel, room_type_code: str) -> dict:
    """Снимок того, что реально уедет гостю."""
    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        bindings: dict[str, list[Binding]] = {}
        for binding in Binding.objects.filter(element__room_type=room_type).select_related(
            "variable", "element"
        ):
            bindings.setdefault(binding.element_id, []).append(binding)

        elements = list(
            ControlElement.objects.filter(room_type=room_type)
            .select_related("zone")
            .order_by("sort_order", "slug")
        )

        zones: dict[str, dict] = {}
        for element in elements:
            status = builder.element_status(element, bindings.get(element.pk, []))
            # Непривязанный элемент в снимок НЕ попадает: гостю не показывают
            # кнопку, за которой нет оборудования.
            if not status.publishable:
                continue

            kind = catalog.ELEMENTS[element.kind]
            zone_code = element.zone.code if element.zone else ""
            zone = zones.setdefault(
                zone_code,
                {
                    "code": zone_code,
                    "title": element.zone.title if element.zone else {},
                    "sort_order": element.zone.sort_order if element.zone else 0,
                    "icon": element.zone.icon if element.zone else "",
                    "controls": [],
                },
            )

            control = {
                "controlId": element.slug,
                "kind": element.kind,
                "title": element.title or {"ru": kind.title_ru},
                # Глиф и подписи состояния кладутся В СНИМОК, а не выводятся на
                # фронте: разбирать controlId строкой ему запрещено, а по kind
                # он умеет отличать разве что свет от шторы — сцены между собой
                # и комнаты между собой не различает вовсе.
                #
                # Приоритет: элемент → зона (только там, где вид этого просит)
                # → вид из каталога. Так три сцены получают три разных значка,
                # свет в спальне — кровать, а штора в гостиной остаётся шторой,
                # а не превращается в диван.
                "icon": (
                    element.icon
                    or (
                        (element.zone.icon if element.zone else "")
                        if kind.prefers_zone_icon
                        else ""
                    )
                    or kind.icon
                ),
                "states": kind.states,
                # Подпись элемента — оттуда же, откуда глиф: с сервера. Пусто у
                # большинства элементов, и это нормально — карточка обходится
                # названием.
                "hint": element.hint or {},
                "capabilities": [],
                "channels": {},
                "range": {},
            }
            for binding in sorted(bindings.get(element.pk, []), key=lambda b: b.capability):
                variable = binding.variable
                control["capabilities"].append(binding.capability)
                # Технические имена лежат в снимке, но НЕ уходят гостю: их
                # разворачивает backend по controlId (см. contracts/guest-api).
                control["channels"][binding.capability] = {
                    "command": variable.command,
                    "feedback": variable.feedback,
                    "subdevice": room_type.subdevice or "",
                    "trigger_value": binding.trigger_value,
                }
                control["range"][binding.capability] = {
                    "min": variable.min_value,
                    "max": variable.max_value,
                    "kind": variable.value_kind,
                }
            zone["controls"].append(control)

        published = sorted(zones.values(), key=lambda z: (z["sort_order"], z["code"]))
        return {
            "type": room_type.code,
            "title": room_type.title,
            "device_name_template": room_type.device_name_template,
            "subdevice": room_type.subdevice or "",
            "zones": published,
            "plan": _plan(room_type, published),
        }


def _plan(room_type, zones: list[dict]) -> dict:
    """
    Геометрия плана номера — ВНУТРИ снимка, а не отдельной таблицей.

    Условие совместимости, а не вкусовщина: снимок самодостаточен, и откат к v2
    обязан вернуть геометрию v2. Отдельная таблица это свойство ломает —
    откат конфигурации оставил бы новую разметку поверх старых элементов, то
    есть точки управления оказались бы не там, где оборудование.

    Всё в ПРОЦЕНТАХ от кадра: рендер и разметка иначе разъедутся при смене
    размера картинки, а новый тип номера с другим рендером должен подключаться
    без правки фронта.

    Нормализация идёт по УЖЕ СОБРАННЫМ зонам снимка: на плане не остаётся ни
    одной ссылки на элемент, которого в этой версии нет. Правило то же, по
    которому непривязанный элемент не попадает в снимок, — просто применённое
    к разметке.
    """
    control_ids = {
        control.get("controlId")
        for zone in zones
        for control in zone.get("controls", [])
        if control.get("controlId")
    }
    return plan_geometry.normalize(room_type.plan, control_ids=control_ids)


def publish(hotel, room_type_code: str, *, actor_id=None) -> PublishedConfig:
    """
    Опубликовать текущее состояние как новую версию.

    Публикация ЗАПРЕЩЕНА, если в снимок не попал ни один элемент: опубликовать
    пустую конфигурацию значит показать гостю экран управления без единой
    кнопки и считать это успехом.
    """
    snapshot = build_snapshot(hotel, room_type_code)
    if not any(zone["controls"] for zone in snapshot["zones"]):
        raise ValidationError(
            "Публиковать нечего: ни один элемент не связан с переменными",
            field="elements",
        )

    # Разметка плана, ссылающаяся в пустоту, БЛОКИРУЕТ публикацию.
    #
    # Раньше такие ссылки молча выбрасывались, и это было хуже: администратор
    # разметил зону, потом снял или переименовал элемент — зона на плане
    # перестала быть кликабельной, а он об этом не узнал. Ошибку нашли бы в
    # номере, причём не он.
    with tenant_context(hotel):
        draft = builder._type(room_type_code).plan
    control_ids = {
        control["controlId"] for zone in snapshot["zones"] for control in zone["controls"]
    }
    broken = plan_geometry.dangling(draft, control_ids=control_ids)
    if broken:
        zones = [item["code"] or "—" for item in broken if item["kind"] == "zone"]
        refs = sorted({item["ref"] for item in broken if item["ref"]})
        parts = []
        if zones:
            parts.append("зоны без рабочего элемента: " + ", ".join(zones))
        if refs:
            parts.append("нет таких элементов: " + ", ".join(refs))
        raise ValidationError(
            "План ссылается на то, чего не будет в этой версии — " + "; ".join(parts),
            field="plan",
        )

    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        with transaction.atomic():
            last = (
                PublishedConfig.objects.filter(room_type=room_type)
                .order_by("-version")
                .first()
            )
            version = (last.version + 1) if last else 1

            # Снимаем текущую ДО создания новой: частичный уникальный индекс
            # разрешает ровно одну текущую версию на тип.
            PublishedConfig.objects.filter(room_type=room_type, is_current=True).update(
                is_current=False
            )
            config = PublishedConfig.objects.create(
                room_type=room_type,
                version=version,
                payload=snapshot,
                is_current=True,
                published_at=timezone.now(),
                published_by=actor_id,
            )

        AuditLog.record(
            "grms.publish",
            actor_type=AuditLog.ActorType.STAFF,
            actor_id=actor_id,
            object_type="grms.room_type",
            object_id=room_type.pk,
            payload={
                "type": room_type.code,
                "version": version,
                "controls": sum(len(z["controls"]) for z in snapshot["zones"]),
            },
            hotel_id=hotel.pk,
        )
    return config


def rollback(hotel, room_type_code: str, *, to_version: int, actor_id=None) -> PublishedConfig:
    """
    Откат — публикация КОПИИ старой версии новым номером, а не удаление новых.

    История не переписывается: иначе вопрос «почему в номере перестал работать
    свет» становится неотвечаемым, а именно на него и приходится отвечать.
    """
    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        source = PublishedConfig.objects.filter(
            room_type=room_type, version=to_version
        ).first()
        if source is None:
            raise NotFoundError(f"Версии {to_version} у типа «{room_type_code}» нет")

        with transaction.atomic():
            last = (
                PublishedConfig.objects.filter(room_type=room_type).order_by("-version").first()
            )
            if last and last.version == to_version and last.is_current:
                raise ValidationError(
                    f"Версия {to_version} и так текущая", field="to_version"
                )
            PublishedConfig.objects.filter(room_type=room_type, is_current=True).update(
                is_current=False
            )
            config = PublishedConfig.objects.create(
                room_type=room_type,
                version=(last.version + 1) if last else 1,
                payload=source.payload,
                is_current=True,
                published_at=timezone.now(),
                published_by=actor_id,
                rolled_back_from=to_version,
            )

        AuditLog.record(
            "grms.rollback",
            actor_type=AuditLog.ActorType.STAFF,
            actor_id=actor_id,
            object_type="grms.room_type",
            object_id=room_type.pk,
            payload={"type": room_type.code, "to_version": to_version, "new_version": config.version},
            hotel_id=hotel.pk,
        )
    return config


def current(hotel, room_type_code: str) -> PublishedConfig | None:
    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        return PublishedConfig.objects.filter(room_type=room_type, is_current=True).first()


def history(hotel, room_type_code: str) -> list[dict]:
    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        return [
            {
                "version": config.version,
                "is_current": config.is_current,
                "published_at": config.published_at,
                "rolled_back_from": config.rolled_back_from,
                "controls": sum(len(z["controls"]) for z in (config.payload or {}).get("zones", [])),
            }
            for config in PublishedConfig.objects.filter(room_type=room_type).order_by("-version")
        ]
