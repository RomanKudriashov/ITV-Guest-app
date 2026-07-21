"""
Сборка меню для гостя.

Вся логика доступности — здесь, а не во вьюхе: расписание, стоп-лист,
локализация, фолбэк картинок. Тот же код переиспользуют CMS-предпросмотр и
будущий ТВ-модуль.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from apps.core.fields import translate
from apps.media.services import image_url

from .models import Category, Item, ModifierGroup, OfferingType


@dataclass(slots=True)
class MenuOptions:
    language: str | None = None
    moment: datetime | None = None
    include_unavailable: bool = True
    offering_type: str = OfferingType.PRODUCT
    location_id: Any = None


def build_menu(options: MenuOptions | None = None) -> dict[str, Any]:
    """
    Плоский по категориям, вложенный по позициям — ровно то, что нужно
    витрине. Недоступные позиции по умолчанию НЕ прячем: гостю полезнее
    увидеть «завтрак с 7:00», чем пустой раздел.
    """
    options = options or MenuOptions()
    language = options.language

    categories = (
        Category.objects.filter(type=options.offering_type, is_active=True)
        .select_related("schedule", "image", "parent")
        .prefetch_related("schedule__intervals")
        .order_by("sort_order", "code")
    )
    if options.location_id:
        categories = categories.filter(
            service_locations__location_id=options.location_id,
            service_locations__is_enabled=True,
        ).distinct()

    items_by_category: dict[Any, list[Item]] = {}
    items = (
        Item.objects.filter(type=options.offering_type, is_active=True)
        .select_related("schedule")
        .prefetch_related(
            "schedule__intervals",
            "images__asset",
            "modifier_groups__options",
        )
        .order_by("sort_order", "code")
    )
    for item in items:
        items_by_category.setdefault(item.category_id, []).append(item)

    payload_categories = []
    for category in categories:
        category_available = category.is_available_at(options.moment)
        serialized_items = [
            _serialize_item(item, language, options.moment, category)
            for item in items_by_category.get(category.pk, [])
        ]
        if not options.include_unavailable:
            serialized_items = [i for i in serialized_items if i["is_available"]]
            if not (category_available and serialized_items):
                continue

        payload_categories.append(
            {
                "id": str(category.pk),
                "code": category.code,
                "parent_id": str(category.parent_id) if category.parent_id else None,
                "title": translate(category.title, language),
                "description": translate(category.description, language),
                "image_url": image_url(
                    category.image, variant="card", fallback_code=category.code
                ),
                "sort_order": category.sort_order,
                "is_available": category_available,
                "unavailable_reason": None if category_available else "schedule",
                "items": serialized_items,
            }
        )

    return {"language": language, "categories": payload_categories}


def _serialize_item(
    item: Item, language: str | None, moment: datetime | None, category: Category
) -> dict[str, Any]:
    available = item.is_available_at(moment) and category.is_available_at(moment)
    reason = None
    if not available:
        if not item.in_stock:
            reason = "out_of_stock"
        elif item.schedule_id or category.schedule_id:
            reason = "schedule"
        else:
            reason = "inactive"

    images = [
        image_url(link.asset, variant="card", fallback_code=category.code)
        for link in item.images.all()
    ]
    if not images:
        images = [image_url(None, fallback_code=category.code)]

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
        "is_available": available,
        "unavailable_reason": reason,
        "modifier_groups": [
            _serialize_modifier_group(group, language)
            for group in item.modifier_groups.all()
        ],
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
