"""
Каталог: то, что гость видит и заказывает.

Одни и те же таблицы обслуживают все типы предложений. Еда — `product`
(корзина, модификаторы, цена), заявка-услуга — `service_request` (форма полей,
одна заявка, маршрут в свой отдел). Различия между типами собраны в
offerings.py одной таблицей поведений, а не разбросаны условиями по коду.

Правило на будущее и обоснования — docs/offering-types.md.

Модели разложены по ресурсам (category, item, modifier, facets, badge, routing,
slots, inclusions), но импортируются по-прежнему из `apps.catalog.models`:
имя приложения и таблицы не менялись, и 43 файла, которые уже это пишут, не
должны знать, в каком из модулей лежит класс.
"""

from __future__ import annotations

# Типы предложений и их поведения живут в offerings.py — там же собраны все
# различия между ними. Здесь только реэкспорт, чтобы модели читались привычно.
from apps.catalog.offerings import LocationMode, OfferingType, behaviour_for

from .badge import Badge, ItemBadge
from .category import Category
from .facets import Allergen, DietaryMarker, ItemAllergen, ItemDietaryMarker
from .inclusions import (
    ServiceInclusion,
    ServiceInclusionCategory,
    ServiceInclusionHidden,
)
from .item import Item, ItemCharacteristic, ItemImage
from .modifier import ModifierGroup, ModifierOption, RequestField
from .routing import Route, ServiceLocation
from .slots import SlotBooking, SlotConfig

__all__ = [
    "Allergen",
    "Badge",
    "Category",
    "DietaryMarker",
    "Item",
    "ItemAllergen",
    "ItemBadge",
    "ItemCharacteristic",
    "ItemDietaryMarker",
    "ItemImage",
    "LocationMode",
    "ModifierGroup",
    "ModifierOption",
    "OfferingType",
    "RequestField",
    "Route",
    "ServiceInclusion",
    "ServiceInclusionCategory",
    "ServiceInclusionHidden",
    "ServiceLocation",
    "SlotBooking",
    "SlotConfig",
    "behaviour_for",
]
