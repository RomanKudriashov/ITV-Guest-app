"""
Сборка витрины для гостя.

Витрина отдаёт **уже локализованные строки**, а не словари переводов: гостю не
нужен весь набор языков, ему нужен свой. Это же отличает выдачу от CMS, где
переводы отдаются целиком.

Доступность считает apps/catalog/availability.py — один расчёт и для показа, и
для валидации заказа. Расхождение здесь дало бы худший баг витрины: позицию,
которую видно, но нельзя заказать.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from apps.core.fields import translate
from apps.hotels.models import Hotel
from apps.media.services import image_url

from .availability import category_availability, item_availability
from .offerings import behaviour_for
from .models import Category, Item, ModifierGroup, OfferingType, RequestField


@dataclass(slots=True)
class MenuOptions:
    language: str | None = None
    moment: datetime | None = None
    include_unavailable: bool = True
    offering_type: str = OfferingType.PRODUCT
    location_id: Any = None
    # Скоуп по заведению: код точки исполнения. None — весь каталог типа (как
    # раньше). Заданный — только категории, замаршрутизированные на эту точку.
    point_code: str | None = None


def build_menu(options: MenuOptions | None = None, *, hotel: Hotel | None = None) -> dict[str, Any]:
    """
    Плоский по категориям, вложенный по позициям — ровно то, что нужно витрине.

    Недоступные позиции по умолчанию НЕ прячем: гостю полезнее увидеть
    «завтрак с 07:00», чем пустой раздел. Заказать их всё равно не выйдет.
    """
    options = options or MenuOptions()
    language = options.language

    categories = (
        Category.objects.filter(type=options.offering_type, is_active=True)
        .select_related("schedule", "image", "parent", "parent__schedule")
        .prefetch_related("schedule__intervals", "parent__schedule__intervals")
        .order_by("sort_order", "code")
    )
    if options.location_id:
        categories = categories.filter(
            service_locations__location_id=options.location_id,
            service_locations__is_enabled=True,
        ).distinct()
    if options.point_code:
        # Скоуп заведения: только категории, замаршрутизированные на его точку.
        categories = categories.filter(
            routes__execution_point__code=options.point_code,
            routes__is_active=True,
        ).distinct()

    items_by_category: dict[Any, list[Item]] = {}
    for item in _item_queryset(options.offering_type):
        items_by_category.setdefault(item.category_id, []).append(item)

    payload_categories = []
    for category in categories:
        state = category_availability(category, options.moment)
        serialized_items = [
            _serialize_item(item, language, options.moment, category)
            for item in items_by_category.get(category.pk, [])
        ]
        if not options.include_unavailable:
            serialized_items = [entry for entry in serialized_items if entry["is_available"]]
            if not (state.is_available and serialized_items):
                continue

        payload_categories.append(
            {
                "id": str(category.pk),
                "code": category.code,
                "parent_id": str(category.parent_id) if category.parent_id else None,
                "title": translate(category.title, language),
                "description": translate(category.description, language),
                "image_url": image_url(category.image, variant="card", fallback_code=category.code),
                "sort_order": category.sort_order,
                **state.as_dict(),
                "items": serialized_items,
            }
        )

    hotel = hotel or Hotel.objects.filter(pk=_current_hotel_id()).first()
    return {
        "language": language,
        "server_time": (hotel.local_now().isoformat() if hotel else None),
        "hero_image": _catalog_hero_image(options.point_code),
        "categories": payload_categories,
    }


def _catalog_hero_image(point_code: str | None = None) -> str | None:
    """
    Фото заведения для hero каталога. При скоупе — фото ИМЕННО этой точки; иначе
    первая активная точка с готовым фото. null → витрина берёт фон бренда/
    градиент (каскад завершает фронт).
    """
    from apps.hotels.models import ExecutionPoint

    points = ExecutionPoint.objects.filter(is_active=True, image__isnull=False).select_related("image")
    if point_code:
        points = points.filter(code=point_code)
    point = points.order_by("code").first()
    if point is None or point.image is None:
        return None
    return point.image.url("card") or None


def _current_hotel_id():
    from apps.core.context import current_hotel_id

    return current_hotel_id()


def _item_queryset(offering_type: str | None = OfferingType.PRODUCT):
    """
    offering_type=None — без фильтра по типу. Нужно при выборке одной позиции
    по id: там тип уже задан самой позицией, и фильтр по умолчанию прятал бы
    услуги, пришедшие по прямой ссылке.
    """
    queryset = (
        Item.objects.filter(is_active=True)
        .select_related("schedule", "category", "category__schedule")
        .prefetch_related(
            "schedule__intervals",
            "category__schedule__intervals",
            "images__asset",
            "modifier_groups__options",
            "request_fields",
        )
        .order_by("sort_order", "code")
    )
    if offering_type is not None:
        queryset = queryset.filter(type=offering_type)
    return queryset


def get_item_detail(item_id, *, language: str | None = None, moment: datetime | None = None) -> dict:
    """
    Карточка позиции любого типа: у товара непуст блок модификаторов, у
    заявки-услуги — блок полей.
    """
    from apps.core.errors import NotFoundError

    item = _item_queryset(None).filter(pk=item_id).first()
    if item is None:
        raise NotFoundError("Позиция не найдена")

    payload = _serialize_item(item, language, moment, item.category)
    payload["category_title"] = translate(item.category.title, language)
    # Конверт один: у товара непуст блок модификаторов, у заявки — блок полей.
    # Клиент смотрит на то, что пришло, а не на тип.
    payload["modifier_groups"] = [
        _serialize_modifier_group(group, language) for group in item.modifier_groups.all()
    ]
    payload["request_fields"] = [
        _serialize_request_field(request_field, language)
        for request_field in item.request_fields.all()
    ]
    return payload


def _serialize_request_field(request_field: RequestField, language: str | None) -> dict[str, Any]:
    return {
        "id": str(request_field.pk),
        "code": request_field.code,
        "label": translate(request_field.label, language),
        "help_text": translate(request_field.help_text, language),
        "field_type": request_field.field_type,
        "is_required": request_field.is_required,
        "options": [
            {"value": option.get("value"), "label": translate(option.get("label"), language)}
            for option in (request_field.options or [])
        ],
        "min_value": request_field.min_value,
        "max_value": request_field.max_value,
        "sort_order": request_field.sort_order,
    }


def _serialize_item(
    item: Item, language: str | None, moment: datetime | None, category: Category
) -> dict[str, Any]:
    state = item_availability(item, moment, category=category)

    images = [
        image_url(link.asset, variant="card", fallback_code=category.code)
        for link in item.images.all()
    ]
    images = [url for url in images if url] or [image_url(None, fallback_code=category.code)]

    groups = list(item.modifier_groups.all())
    return {
        "id": str(item.pk),
        "code": item.code,
        "type": item.type,
        "location_mode": item.location_mode,
        "category_id": str(item.category_id),
        "title": translate(item.title, language),
        "description": translate(item.description, language),
        "price": item.price,
        "flags": list(item.flags or []),
        "allergens": list(item.allergens or []),
        # Маркетинговые бейджи — отдельно от фактических флагов.
        "badges": _badges(item, language),
        # Пищевая ценность и состав — из attributes (данные позиции). Карточка
        # показывает секцию, только если значения есть.
        "nutrition": _nutrition(item, language),
        # Время подачи, мин: чип в карточке; null — не показывать.
        "prep_minutes": item.prep_minutes,
        "images": [url for url in images if url],
        # Витрине важно заранее знать, открывать ли карточку: позицию без
        # модификаторов можно добавить прямо из списка одним тапом.
        "has_modifiers": bool(groups),
        "has_required_modifiers": any(group.is_required for group in groups),
        # Витрине хватает признака, чтобы решить, чем открывать позицию:
        # карточкой с корзиной, формой заявки, страницей чтения или бронью.
        "has_fields": bool(item.request_fields.all()),
        "has_content": bool(item.content),
        "has_slots": behaviour_for(item.type).uses_slots,
        "is_orderable": behaviour_for(item.type).creates_order,
        "content": translate(item.content, language),
        **state.as_dict(),
    }


def _badges(item, language: str | None = None) -> list[dict[str, Any]]:
    """Активные бейджи позиции в порядке назначения — без отдельного запроса."""
    out = []
    for link in item.item_badges.select_related("badge").all():
        badge = link.badge
        if badge is not None and badge.is_active:
            out.append(
                {
                    "label": translate(badge.label, language),
                    "color_role": badge.color_role,
                    "sort_order": link.sort_order,
                }
            )
    out.sort(key=lambda entry: entry["sort_order"])
    return out


def _nutrition(item, language: str | None = None) -> dict[str, Any] | None:
    """
    Пищевая ценность и состав из attributes. Форма:
        attributes = {"nutrition": {"calories": 320, "protein": 12, "fat": 18,
                                    "carbs": 9, "composition": {"ru": "..."}}}
    Возвращает None, если данных нет — карточка тогда не рисует секцию.
    """
    data = (item.attributes or {}).get("nutrition") if isinstance(item.attributes, dict) else None
    if not data:
        return None
    composition = data.get("composition")
    if isinstance(composition, dict):
        composition = translate(composition, language)
    return {
        "calories": data.get("calories"),
        "protein": data.get("protein"),
        "fat": data.get("fat"),
        "carbs": data.get("carbs"),
        "composition": composition or "",
    }


def _serialize_modifier_group(group: ModifierGroup, language: str | None) -> dict[str, Any]:
    return {
        "id": str(group.pk),
        "code": group.code,
        "title": translate(group.title, language),
        "selection": group.selection,
        "is_required": group.is_required,
        "min_choices": group.min_choices,
        "max_choices": group.max_choices,
        "options": [
            {
                "id": str(option.pk),
                "code": option.code,
                "title": translate(option.title, language),
                "price_delta": option.price_delta,
                "is_default": option.is_default,
            }
            for option in group.options.all()
            if option.is_active
        ],
    }
