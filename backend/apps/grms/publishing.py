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
                    "controls": [],
                },
            )

            control = {
                "controlId": element.slug,
                "kind": element.kind,
                "title": element.title or {"ru": kind.title_ru},
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

        return {
            "type": room_type.code,
            "title": room_type.title,
            "device_name_template": room_type.device_name_template,
            "subdevice": room_type.subdevice or "",
            "zones": sorted(zones.values(), key=lambda z: (z["sort_order"], z["code"])),
            "plan": _plan(room_type),
        }


def _plan(room_type) -> dict:
    """
    Геометрия плана номера — ВНУТРИ снимка, а не отдельной таблицей.

    Условие совместимости, а не вкусовщина: снимок самодостаточен, и откат к v2
    обязан вернуть геометрию v2. Отдельная таблица это свойство ломает —
    откат конфигурации оставил бы новую разметку поверх старых элементов, то
    есть точки управления оказались бы не там, где оборудование.

    Всё в ПРОЦЕНТАХ от кадра: рендер и разметка иначе разъедутся при смене
    размера картинки, а новый тип номера с другим рендером должен подключаться
    без правки фронта.

    Заполняется в G5b (план-двойник). Здесь резервируется форма — по образцу
    docs/design/grms-concept/plan-geometry.json, — чтобы следующий прогон не
    тянул за собой ни миграцию, ни смену формата опубликованных версий.
    """
    return {
        # UUID ассета рендера (MediaAsset.Kind.ROOM_PLAN). URL резолвит
        # backend — фронт не собирает адреса строкой.
        "asset_id": None,
        # Соотношение сторон кадра: чтобы сверстать плиту до загрузки картинки.
        "aspect": None,
        # [{"code", "title", "hit": {x,y,w,h}, "mask": {x,y,w,h}}]
        "zones": [],
        # [{"controlId", "x", "y"}]
        "points": [],
    }


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
