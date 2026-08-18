"""
Сервисный слой админки отеля: номера, локации, отделы.

Логика в сервисах, вьюхи тонкие. Тенант нигде не фильтруется руками —
менеджеры скоупят, RLS страхует.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction

from apps.catalog.models import Category, ServiceLocation
from apps.accounts.services.roles import (
    HotelAdminOnly,
    current_access,
    require_hotel_admin,
    require_point_scope,
)
from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.core.fields import translate
from apps.media.models import MediaAsset
from apps.media.services import serialize_asset

from apps.hotels.models import ExecutionPoint, Hotel, Location, Room, Schedule, Service
from apps.hotels.venue_defaults import service_type_for_kind

MAX_BULK_RANGE = 500


# --- Номера ----------------------------------------------------------------


def serialize_room(room: Room, *, hotel: Hotel | None = None) -> dict:
    hotel = hotel or room.hotel
    return {
        "id": str(room.pk),
        "number": room.number,
        "floor": room.floor,
        "zone": room.zone,
        "source": room.source,
        "is_active": room.is_active,
        "guest_url": hotel.room_deeplink(room.number),
    }


def list_rooms(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    """Поиск по НОМЕРУ и ЭТАЖУ — единственное, что о номере помнят наизусть."""
    from apps.core.listing import page as list_page, search as apply_search

    hotel = Hotel.objects.get(pk=require_hotel_id())
    rooms = apply_search(Room.objects.order_by("number"), search, ("number", "floor"))
    return list_page(
        rooms, limit=limit, offset=offset, serialize=lambda room: serialize_room(room, hotel=hotel)
    )


def get_room(room_id) -> Room:
    room = Room.objects.filter(pk=room_id).first()
    if room is None:
        raise NotFoundError("Номер не найден")
    return room


@transaction.atomic
def create_room(data: dict) -> Room:
    require_hotel_admin()
    number = str(data.get("number") or "").strip()
    if not number:
        raise ValidationError("Укажите номер", field="number")
    if Room.all_objects.filter(number=number).exists():
        raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")

    return Room.objects.create(
        number=number,
        floor=str(data.get("floor") or "").strip(),
        zone=str(data.get("zone") or "").strip(),
        is_active=data.get("is_active", True),
    )


@transaction.atomic
def update_room(room_id, data: dict) -> Room:
    require_hotel_admin()
    room = get_room(room_id)
    if "number" in data:
        number = str(data["number"] or "").strip()
        if not number:
            raise ValidationError("Укажите номер", field="number")
        if Room.all_objects.filter(number=number).exclude(pk=room.pk).exists():
            raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")
        room.number = number
    if "floor" in data:
        room.floor = str(data["floor"] or "").strip()
    if "zone" in data:
        room.zone = str(data["zone"] or "").strip()
    if "is_active" in data:
        room.is_active = data["is_active"]
    room.save()
    return room


def delete_room(room_id) -> None:
    require_hotel_admin()
    get_room(room_id).delete()


@transaction.atomic
def bulk_create_rooms(data: dict) -> dict:
    """
    Диапазон номеров одним действием. Уже существующие пропускаются молча —
    повторный вызов не падает и не двоит: заводить отель по частям это норма.
    """
    require_hotel_admin()
    try:
        start = int(data["from"])
        end = int(data["to"])
    except (KeyError, TypeError, ValueError):
        raise ValidationError("Границы диапазона должны быть числами", field="from") from None

    if start > end:
        raise ValidationError("Начало диапазона больше конца", field="from", code="bad_range")
    if end - start + 1 > MAX_BULK_RANGE:
        raise ValidationError(
            f"За один раз не больше {MAX_BULK_RANGE} номеров",
            field="to",
            code="range_too_large",
        )

    prefix = str(data.get("prefix") or "")
    suffix = str(data.get("suffix") or "")
    floor = str(data.get("floor") or "").strip()
    zone = str(data.get("zone") or "").strip()

    existing = set(Room.all_objects.values_list("number", flat=True))
    created, skipped = [], []
    to_create = []
    for value in range(start, end + 1):
        number = f"{prefix}{value}{suffix}"
        if number in existing:
            skipped.append(number)
            continue
        to_create.append(
            Room(hotel_id=require_hotel_id(), number=number, floor=floor, zone=zone)
        )
        created.append(number)

    Room.objects.bulk_create(to_create)
    return {"created": created, "skipped": skipped}


def room_qr_targets() -> tuple[Hotel, list[Room]]:
    hotel = Hotel.objects.get(pk=require_hotel_id())
    return hotel, list(Room.objects.filter(is_active=True).order_by("number"))


# --- Локации ---------------------------------------------------------------


def serialize_location(location: Location) -> dict:
    return {
        "id": str(location.pk),
        "code": location.code,
        "kind": location.kind,
        "title": location.title or {},
        "requires_refinement": location.requires_refinement,
        "refinement_label": location.refinement_label or {},
        "schedule_id": str(location.schedule_id) if location.schedule_id else None,
        "sort_order": location.sort_order,
        "is_active": location.is_active,
        "delivery_fee_minor": location.delivery_fee_minor,
    }


def list_locations(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    """Локации ищутся по КОДУ и НАЗВАНИЮ."""
    from apps.core.listing import page as list_page, search as apply_search

    queryset = apply_search(
        Location.objects.order_by("sort_order", "code"), search, ("code",), json_fields=("title",)
    )
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_location)


def get_location(location_id) -> Location:
    location = Location.objects.filter(pk=location_id).first()
    if location is None:
        raise NotFoundError("Локация не найдена")
    return location


def _clean_translations(value: Any, *, field: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("Ожидается объект {язык: значение}", field=field)
    return {str(k): str(v).strip() for k, v in value.items() if v and str(v).strip()}


def _make_location_code(title: dict) -> str:
    from apps.catalog.services.cms import make_code

    return make_code(Location, title, prefix="location")


def _resolve_schedule(schedule_id) -> Schedule | None:
    if not schedule_id:
        return None
    schedule = Schedule.objects.filter(pk=schedule_id).first()
    if schedule is None:
        raise ValidationError("Расписание не найдено", field="schedule_id")
    return schedule


def _validate_refinement(requires: bool, label: dict) -> None:
    if requires and not label:
        raise ValidationError(
            "Локация с уточнением требует подписи поля",
            field="refinement_label",
            code="refinement_label_required",
        )


@transaction.atomic
def create_location(data: dict) -> Location:
    require_hotel_admin()
    title = _clean_translations(data.get("title"), field="title")
    if not title:
        raise ValidationError("Заполните название локации", field="title")
    requires = data.get("requires_refinement", False)
    label = _clean_translations(data.get("refinement_label"), field="refinement_label")
    _validate_refinement(requires, label)

    return Location.objects.create(
        code=data.get("code") or _make_location_code(title),
        kind=data.get("kind", Location.Kind.IN_ROOM),
        title=title,
        requires_refinement=requires,
        refinement_label=label,
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order", 0),
        is_active=data.get("is_active", True),
    )


@transaction.atomic
def update_location(location_id, data: dict) -> Location:
    require_hotel_admin()
    location = get_location(location_id)
    if "title" in data:
        title = _clean_translations(data["title"], field="title")
        if not title:
            raise ValidationError("Заполните название локации", field="title")
        location.title = title
    if "kind" in data:
        location.kind = data["kind"]
    if "requires_refinement" in data:
        location.requires_refinement = data["requires_refinement"]
    if "refinement_label" in data:
        location.refinement_label = _clean_translations(data["refinement_label"], field="refinement_label")
    if "schedule_id" in data:
        location.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data:
        location.sort_order = data["sort_order"]
    if "is_active" in data:
        location.is_active = data["is_active"]
    if "delivery_fee_minor" in data:
        fee = data["delivery_fee_minor"]
        if not isinstance(fee, int) or isinstance(fee, bool) or fee < 0:
            raise ValidationError(
                "Стоимость доставки — неотрицательное целое копеек",
                field="delivery_fee_minor",
                code="out_of_range",
            )
        location.delivery_fee_minor = fee

    _validate_refinement(location.requires_refinement, location.refinement_label or {})
    location.save()
    return location


def delete_location(location_id) -> None:
    require_hotel_admin()
    get_location(location_id).delete()


# --- Матрица «категория → локации» -----------------------------------------


def location_matrix(language: str | None = None) -> dict:
    from apps.catalog.models import OfferingType

    locations = list(Location.objects.filter(is_active=True).order_by("sort_order", "code"))
    categories = list(Category.objects.order_by("sort_order", "code"))

    links = {
        (link.category_id, link.location_id): link
        for link in ServiceLocation.objects.all()
    }

    rows = []
    for category in categories:
        cells = []
        for location in locations:
            link = links.get((category.pk, location.pk))
            cells.append(
                {
                    "location_id": str(location.pk),
                    "enabled": bool(link and link.is_enabled),
                    "delivery_modes": list(link.delivery_modes) if link else [],
                }
            )
        rows.append(
            {
                "category_id": str(category.pk),
                "category_title": translate(category.title, language),
                "category_type": category.type,
                "cells": cells,
            }
        )

    return {
        "locations": [
            {"id": str(loc.pk), "code": loc.code, "title": translate(loc.title, language)}
            for loc in locations
        ],
        "rows": rows,
    }


@transaction.atomic
def update_matrix_row(category_id, cells: Iterable[dict]) -> dict:
    require_hotel_admin()
    category = Category.objects.filter(pk=category_id).first()
    if category is None:
        raise ValidationError("Категория не найдена", field="category_id")

    valid_modes = set(dict(ServiceLocation.DeliveryMode.choices))
    for cell in cells:
        location_id = cell.get("location_id")
        location = Location.objects.filter(pk=location_id).first()
        if location is None:
            raise ValidationError("Локация не найдена", field="location_id")

        modes = [mode for mode in (cell.get("delivery_modes") or []) if mode in valid_modes]
        if not cell.get("enabled"):
            # Join-строка матрицы истории не несёт — удаляем жёстко, иначе
            # мягко-удалённая строка блокирует повторное включение уникальным
            # индексом (hotel, category, location).
            ServiceLocation.all_objects.filter(category=category, location=location).hard_delete()
            continue

        # all_objects: оживляем мягко-удалённую связку, а не плодим дубль.
        ServiceLocation.all_objects.update_or_create(
            category=category,
            location=location,
            defaults={"delivery_modes": modes or ["delivery"], "is_enabled": True, "deleted_at": None},
        )

    return location_matrix()




# ===========================================================================
# Сервисы — верхний уровень CMS
# ===========================================================================
#
# До R4 то же самое звалось «отделами» и адресовалось id ТОЧКИ ИСПОЛНЕНИЯ.
# Это было наследство прежней модели: снаружи отель настраивает заведение
# («Панорама»), а не бригаду за ним. Ключ ресурса переехал на сервис, точка
# ушла внутрь — потому что включения (R2) адресуются сервисом, и без его id
# CMS не могла ни показать, ни настроить заимствованный контент.

# Тип сервиса → род исполнителя за ним. Обратная сторона KIND_TO_SERVICE_TYPE:
# отель выбирает ЗАВЕДЕНИЕ, а бригаду под него мы заводим сами.
SERVICE_TYPE_TO_KIND = {
    Service.Type.RESTAURANT: ExecutionPoint.Kind.KITCHEN,
    Service.Type.BAR: ExecutionPoint.Kind.BAR,
    Service.Type.ROOM_SERVICE: ExecutionPoint.Kind.KITCHEN,
    Service.Type.MINIBAR: ExecutionPoint.Kind.OTHER,
    Service.Type.SPA: ExecutionPoint.Kind.SPA,
    Service.Type.POOL: ExecutionPoint.Kind.SPA,
    Service.Type.EXCURSIONS: ExecutionPoint.Kind.RECEPTION,
    Service.Type.TRANSFER: ExecutionPoint.Kind.RECEPTION,
    Service.Type.CONCIERGE: ExecutionPoint.Kind.RECEPTION,
    Service.Type.HOUSEKEEPING: ExecutionPoint.Kind.HOUSEKEEPING,
    Service.Type.INFO: ExecutionPoint.Kind.OTHER,
    Service.Type.CUSTOM: ExecutionPoint.Kind.OTHER,
}

# Разумный порог просрочки на доске по роду работы (минуты). Отель правит.
DEFAULT_SLA = {
    ExecutionPoint.Kind.KITCHEN: 20,
    ExecutionPoint.Kind.BAR: 15,
    ExecutionPoint.Kind.SPA: 30,
    ExecutionPoint.Kind.HOUSEKEEPING: 45,
    ExecutionPoint.Kind.RECEPTION: 10,
    ExecutionPoint.Kind.OTHER: 20,
}


def _resolve_asset(asset_id) -> MediaAsset | None:
    if not asset_id:
        return None
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise ValidationError("Изображение не найдено", field="image_id")
    return asset


def _count_by_point(queryset) -> dict:
    counts: dict = {}
    for point_id in queryset.values_list("execution_point_id", flat=True):
        counts[point_id] = counts.get(point_id, 0) + 1
    return counts


def serialize_service(service: Service, *, counts: dict | None = None) -> dict:
    """
    Сервис глазами CMS: гостевая идентичность + исполнение + коммерция вместе.

    `tracker_type` отдаём здесь же (R3 выводит его из типа сервиса): админ,
    меняя тип заведения, должен видеть, какой рабочий экран получит персонал,
    а не узнавать это по факту.
    """
    from apps.orders.services.tracker_types import tracker_type_for_service_type

    counts = counts or {}
    point = service.execution_point
    return {
        "id": str(service.pk),
        "code": service.code,
        "type": service.type,
        "public_name": service.public_name or {},
        "tagline": service.tagline or {},
        "is_guest_facing": service.is_guest_facing,
        "is_active": service.is_active,
        "sort_order": service.sort_order,
        "schedule_id": str(service.schedule_id) if service.schedule_id else None,
        "image": serialize_asset(service.image),
        "tracker_type": tracker_type_for_service_type(service.type),
        # Исполнение — внутри: снаружи отель настраивает заведение, а бригада
        # за ним детали реализации.
        "execution_point": {
            "id": str(point.pk),
            "code": point.code,
            "title": point.title or {},
            "kind": point.kind,
            "sla_minutes": point.sla_minutes,
        },
        "commerce": {
            field: getattr(service, field) for field in SERVICE_COMMERCE_FIELDS
        },
        "category_count": counts.get("categories", 0),
        "item_count": counts.get("items", 0),
        "staff_count": counts.get("staff", 0),
        "channel_count": counts.get("channels", 0),
        "inclusion_count": counts.get("inclusions", 0),
        "has_escalation": counts.get("escalation", False),
    }


def list_services(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    from django.db.models import Count, Q

    from apps.accounts.models import StaffAssignment
    from apps.accounts.services.roles import managed_point_ids_or_none
    from apps.catalog.models import ServiceInclusion
    from apps.notifications.models import EscalationRule, NotificationChannel

    services = Service.objects.select_related("execution_point", "image").order_by(
        "sort_order", "code"
    )
    managed = managed_point_ids_or_none()
    if managed is not None:
        services = services.filter(execution_point_id__in=managed)
    # Заведение ищут по коду и по гостевому названию (оно переводимое —
    # ищется сразу на всех языках).
    from apps.core.listing import clamp, envelope, search as apply_search

    services = apply_search(services, search, ("code",), json_fields=("public_name",))
    total = services.count()
    limit = clamp(limit)
    services = list(services[max(0, offset) : max(0, offset) + limit])

    # Счётчики одним проходом на таблицу — карточка списка не должна стоить
    # запроса на сервис.
    by_service = dict(
        Category.objects.filter(service__isnull=False)
        .values_list("service_id")
        .annotate(n=Count("id"))
    )
    items_by_service = dict(
        Category.objects.filter(service__isnull=False)
        .annotate(n=Count("items", filter=Q(items__deleted_at__isnull=True)))
        .values_list("service_id", "n")
    )
    staff = _count_by_point(StaffAssignment.objects.filter(is_active=True))
    channels = _count_by_point(NotificationChannel.objects.filter(is_active=True))
    inclusions = dict(
        ServiceInclusion.objects.values_list("including_service_id").annotate(n=Count("id"))
    )
    with_rules = set(
        EscalationRule.objects.filter(
            is_active=True, execution_point__isnull=False
        ).values_list("execution_point_id", flat=True)
    )

    rows = [
        serialize_service(
            service,
            counts={
                "categories": by_service.get(service.pk, 0),
                "items": items_by_service.get(service.pk, 0),
                "staff": staff.get(service.execution_point_id, 0),
                "channels": channels.get(service.execution_point_id, 0),
                "inclusions": inclusions.get(service.pk, 0),
                "escalation": service.execution_point_id in with_rules,
            },
        )
        for service in services
    ]
    return envelope(rows, total, limit, offset=max(0, offset))


def get_service(service_id) -> Service:
    service = (
        Service.objects.select_related("execution_point", "image")
        .filter(pk=service_id)
        .first()
    )
    if service is None:
        raise NotFoundError("Сервис не найден")
    require_point_scope(service.execution_point_id, what="Сервис")
    return service


def service_templates() -> list[dict]:
    """
    Шаблоны для «+ добавить сервис»: тип, из каких кирпичей собран и какой
    рабочий экран получит персонал. Список строится из самих справочников —
    новый тип сервиса появляется здесь сам, без правки шаблонов.
    """
    from apps.catalog.offerings import OfferingType
    from apps.hotels.vocabularies import SERVICE_TYPE_LABELS
    from apps.orders.services.tracker_types import tracker_type_for_service_type

    # Из каких кирпичей собран тип — это и есть «шаблон» карты продукта.
    BRICKS = {
        Service.Type.RESTAURANT: [OfferingType.PRODUCT],
        Service.Type.BAR: [OfferingType.PRODUCT],
        Service.Type.ROOM_SERVICE: [OfferingType.PRODUCT],
        Service.Type.MINIBAR: [OfferingType.PRODUCT],
        Service.Type.SPA: [OfferingType.SLOT],
        Service.Type.POOL: [OfferingType.SLOT],
        Service.Type.EXCURSIONS: [OfferingType.SLOT],
        Service.Type.TRANSFER: [OfferingType.SERVICE_REQUEST],
        Service.Type.CONCIERGE: [OfferingType.SERVICE_REQUEST],
        Service.Type.HOUSEKEEPING: [OfferingType.SERVICE_REQUEST],
        Service.Type.INFO: [OfferingType.INFO],
        Service.Type.CUSTOM: [OfferingType.PRODUCT, OfferingType.SERVICE_REQUEST],
    }
    return [
        {
            "type": value,
            "title": SERVICE_TYPE_LABELS.get(value, {}),
            "bricks": [str(b) for b in BRICKS.get(value, [])],
            "tracker_type": tracker_type_for_service_type(value),
            "default_guest_facing": value != Service.Type.HOUSEKEEPING,
        }
        for value, _label in Service.Type.choices
    ]


@transaction.atomic
def create_service(data: dict) -> Service:
    """
    Завести заведение. Исполнителя под него создаём сами: отель выбирает
    «ресторан», а не «кухня + ресторан» — вторая половина всегда одна и та же,
    и просить её у пользователя значит просить лишнего.
    """
    require_hotel_admin()

    service_type = data.get("type") or Service.Type.CUSTOM
    if service_type not in dict(Service.Type.choices):
        raise ValidationError(f"Неизвестный тип сервиса: {service_type}", field="type")

    public_name = _clean_translations(data.get("public_name"), field="public_name")
    if not public_name:
        raise ValidationError("Заполните название заведения", field="public_name")

    from apps.catalog.services.cms import make_code

    code = data.get("code") or make_code(Service, public_name, prefix="service")
    if Service.all_objects.filter(code=code).exists():
        raise ConflictError(f"Сервис «{code}» уже существует", code="service_exists")

    kind = SERVICE_TYPE_TO_KIND.get(service_type, ExecutionPoint.Kind.OTHER)
    point_code = code if not ExecutionPoint.all_objects.filter(code=code).exists() else f"{code}-ep"
    point = ExecutionPoint.objects.create(
        code=point_code,
        # Служебное имя бригады = гостевое имя заведения, пока отель не задал
        # своё: безымянный отдел в эскалациях и на трекере читается как ошибка.
        title=dict(public_name),
        kind=kind,
        sla_minutes=data.get("sla_minutes") or DEFAULT_SLA.get(kind, 20),
        is_active=True,
    )
    return Service.objects.create(
        execution_point=point,
        code=code,
        type=service_type,
        public_name=public_name,
        tagline=_clean_translations(data.get("tagline"), field="tagline"),
        is_guest_facing=data.get(
            "is_guest_facing", service_type != Service.Type.HOUSEKEEPING
        ),
        schedule=_resolve_schedule(data.get("schedule_id")),
        image=_resolve_asset(data.get("image_id")),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order") or 0,
    )


# Поля заведения, которые меняет ТОЛЬКО администратор отеля: они двигают тип
# трекера, место на витрине и само существование отдела.
HOTEL_LEVEL_SERVICE_FIELDS = frozenset({"code", "type", "is_active"})

SERVICE_COMMERCE_FIELDS = (
    "service_fee_bp",
    "tip_presets",
    "min_order_minor",
    "free_delivery_threshold_minor",
    "price_round_to_minor",
)


@transaction.atomic
def update_service(service_id, data: dict) -> Service:
    """
    Админ отеля меняет что угодно; управляющий — только своё заведение и только
    его наполнение: идентичность, расписание, обложку, SLA и свою коммерцию.
    """
    # get_service сам проверяет область — второй раз спрашивать нечего;
    # у него же берём права, чтобы отсечь поля уровня отеля.
    service = get_service(service_id)
    access = current_access()
    if not access.unrestricted:
        forbidden = sorted(HOTEL_LEVEL_SERVICE_FIELDS & set(data))
        if forbidden:
            raise HotelAdminOnly(
                "Эти поля заведения меняет администратор отеля: " + ", ".join(forbidden)
            )

    point = service.execution_point

    if "public_name" in data:
        public_name = _clean_translations(data["public_name"], field="public_name")
        if not public_name:
            raise ValidationError("Заполните название заведения", field="public_name")
        service.public_name = public_name
    if "tagline" in data:
        service.tagline = _clean_translations(data["tagline"], field="tagline")
    if "is_guest_facing" in data and data["is_guest_facing"] is not None:
        service.is_guest_facing = data["is_guest_facing"]
    if "schedule_id" in data:
        service.schedule = _resolve_schedule(data["schedule_id"])
    if "image_id" in data:
        service.image = _resolve_asset(data["image_id"])
    if "sort_order" in data and data["sort_order"] is not None:
        service.sort_order = data["sort_order"]
    if "type" in data and data["type"]:
        if data["type"] not in dict(Service.Type.choices):
            raise ValidationError(f"Неизвестный тип сервиса: {data['type']}", field="type")
        service.type = data["type"]
        # Тип решает и род бригады, и вид трекера — держим их вместе.
        point.kind = SERVICE_TYPE_TO_KIND.get(data["type"], ExecutionPoint.Kind.OTHER)
    if "is_active" in data and data["is_active"] is not None:
        service.is_active = data["is_active"]
        point.is_active = data["is_active"]
    if "sla_minutes" in data and data["sla_minutes"] is not None:
        point.sla_minutes = data["sla_minutes"]

    for field in SERVICE_COMMERCE_FIELDS:
        if field in data:
            setattr(service, field, _validate_service_commerce(field, data[field]))

    point.save()
    service.save()
    return get_service(service_id)


def _validate_service_commerce(field: str, value):
    """Переопределение коммерции сервиса: либо null (наследовать), либо число."""
    if value is None:
        return None
    if field == "tip_presets":
        if not isinstance(value, list) or any(
            not isinstance(x, int) or isinstance(x, bool) or x < 0 or x > 100 for x in value
        ):
            raise ValidationError("Пресеты чаевых — целые проценты от 0 до 100", field=field)
        return list(dict.fromkeys(value))
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("Ожидается неотрицательное целое", field=field)
    if field == "service_fee_bp" and value > 10_000:
        raise ValidationError("Сбор не может превышать 100%", field=field)
    return value


@transaction.atomic
def delete_service(service_id) -> None:
    require_hotel_admin()
    from apps.orders.models import Order

    service = get_service(service_id)
    point = service.execution_point
    # Заказы ссылаются на точку через PROTECT — удаление осиротило бы историю.
    if Order.all_objects.filter(execution_point=point).exists():
        raise ConflictError(
            "У заведения есть заказы — его можно только выключить",
            code="service_has_orders",
        )
    service.delete()
    point.delete()
