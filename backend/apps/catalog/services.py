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
from .models import Category, Item, ModifierGroup, OfferingType


@dataclass(slots=True)
class MenuOptions:
    language: str | None = None
    moment: datetime | None = None
    include_unavailable: bool = True
    offering_type: str = OfferingType.PRODUCT
    location_id: Any = None


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
        "categories": payload_categories,
    }


def _current_hotel_id():
    from apps.core.context import current_hotel_id

    return current_hotel_id()


def _item_queryset(offering_type: str = OfferingType.PRODUCT):
    return (
        Item.objects.filter(type=offering_type, is_active=True)
        .select_related("schedule", "category", "category__schedule")
        .prefetch_related(
            "schedule__intervals",
            "category__schedule__intervals",
            "images__asset",
            "modifier_groups__options",
        )
        .order_by("sort_order", "code")
    )


def get_item_detail(item_id, *, language: str | None = None, moment: datetime | None = None) -> dict:
    """Карточка блюда: то же, что в меню, плюс полные группы модификаторов."""
    from apps.core.errors import NotFoundError

    item = _item_queryset().filter(pk=item_id).first()
    if item is None:
        raise NotFoundError("Блюдо не найдено")

    payload = _serialize_item(item, language, moment, item.category)
    payload["category_title"] = translate(item.category.title, language)
    payload["modifier_groups"] = [
        _serialize_modifier_group(group, language) for group in item.modifier_groups.all()
    ]
    return payload


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
        "category_id": str(item.category_id),
        "title": translate(item.title, language),
        "description": translate(item.description, language),
        "price": item.price,
        "flags": list(item.flags or []),
        "allergens": list(item.allergens or []),
        "images": [url for url in images if url],
        # Витрине важно заранее знать, открывать ли карточку: позицию без
        # модификаторов можно добавить прямо из списка одним тапом.
        "has_modifiers": bool(groups),
        "has_required_modifiers": any(group.is_required for group in groups),
        **state.as_dict(),
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
