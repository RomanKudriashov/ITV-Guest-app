"""
Схемы каталога — CMS.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from typing import Any

from ninja import Schema

from apps.core.schemas import Translations



class StockIn(Schema):
    in_stock: bool

class CategoryIn(Schema):
    type: str = "product"
    title: Translations
    description: Translations | None = None
    code: str | None = None
    # Заведение, которому принадлежит раздел. Управляющему несколькими
    # сервисами обязателен — иначе непонятно, куда он добавляет раздел.
    service_id: str | None = None
    parent_id: str | None = None
    image_id: str | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool = True

class CategoryPatch(Schema):
    title: Translations | None = None
    description: Translations | None = None
    code: str | None = None
    parent_id: str | None = None
    image_id: str | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    # Коммерция: облагается ли сбором; минимальная сумма по категории.
    service_fee_applies: bool | None = None
    min_order_minor: int | None = None

class CategoryOut(Schema):
    id: str
    parent_id: str | None
    code: str
    type: str
    title: Translations
    description: Translations
    image: dict[str, Any] | None
    schedule_id: str | None
    sort_order: int
    is_active: bool
    items_count: int
    service_fee_applies: bool = True
    min_order_minor: int | None = None

class CategoryTreeOut(CategoryOut):
    children: list[dict[str, Any]] = []

class ItemIn(Schema):
    category_id: str
    type: str = "product"
    location_mode: str | None = None
    title: Translations
    description: Translations | None = None
    content: Translations | None = None
    code: str | None = None
    price: int | None = 0
    # Назначение из словарей (join) + характеристики. Пусто/не задано — не трогаем.
    allergen_ids: list[str] | None = None
    marker_ids: list[str] | None = None
    characteristics: list[dict[str, Any]] | None = None
    image_ids: list[str] | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool = True
    in_stock: bool = True

class ItemPatch(Schema):
    category_id: str | None = None
    type: str | None = None
    location_mode: str | None = None
    title: Translations | None = None
    description: Translations | None = None
    content: Translations | None = None
    code: str | None = None
    price: int | None = None
    allergen_ids: list[str] | None = None
    marker_ids: list[str] | None = None
    characteristics: list[dict[str, Any]] | None = None
    image_ids: list[str] | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    in_stock: bool | None = None
    # Время подачи, мин; null очищает — чип на витрине пропадает.
    prep_minutes: int | None = None

class ItemImagesIn(Schema):
    image_ids: list[str]

class ItemOut(Schema):
    id: str
    category_id: str
    code: str
    type: str
    location_mode: str
    title: Translations
    description: Translations
    content: Translations = {}
    price: int | None
    images: list[dict[str, Any]]
    allergen_ids: list[str] = []
    marker_ids: list[str] = []
    characteristics: list[dict[str, Any]] = []
    schedule_id: str | None
    sort_order: int
    is_active: bool
    in_stock: bool
    prep_minutes: int | None = None
    badges: list[dict[str, Any]] = []

class ItemDetailOut(ItemOut):
    modifier_groups: list[dict[str, Any]] = []
    request_fields: list[dict[str, Any]] = []

class RequestFieldIn(Schema):
    label: Translations
    help_text: Translations | None = None
    code: str | None = None
    field_type: str = "text"
    is_required: bool = False
    options: list[dict[str, Any]] = []
    min_value: int | None = None
    max_value: int | None = None
    sort_order: int | None = None

class RequestFieldPatch(Schema):
    label: Translations | None = None
    help_text: Translations | None = None
    code: str | None = None
    field_type: str | None = None
    is_required: bool | None = None
    options: list[dict[str, Any]] | None = None
    min_value: int | None = None
    max_value: int | None = None
    sort_order: int | None = None

class RequestFieldOut(Schema):
    id: str
    item_id: str
    code: str
    label: Translations
    help_text: Translations
    field_type: str
    is_required: bool
    options: list[dict[str, Any]]
    min_value: int | None
    max_value: int | None
    sort_order: int

class ModifierOptionIn(Schema):
    title: Translations
    code: str | None = None
    price_delta: int = 0
    is_default: bool = False
    is_active: bool = True
    sort_order: int | None = None

class ModifierOptionPatch(Schema):
    title: Translations | None = None
    code: str | None = None
    price_delta: int | None = None
    is_default: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None

class ModifierGroupIn(Schema):
    title: Translations
    code: str | None = None
    selection: str = "single"
    is_required: bool = False
    min_choices: int = 0
    max_choices: int = 1
    sort_order: int | None = None
    options: list[ModifierOptionIn] = []

class ModifierGroupPatch(Schema):
    title: Translations | None = None
    code: str | None = None
    selection: str | None = None
    is_required: bool | None = None
    min_choices: int | None = None
    max_choices: int | None = None
    sort_order: int | None = None

class ModifierOptionOut(Schema):
    id: str
    group_id: str
    code: str
    title: Translations
    price_delta: int
    is_default: bool
    is_active: bool
    sort_order: int

class ModifierGroupOut(Schema):
    id: str
    item_id: str
    code: str
    title: Translations
    selection: str
    is_required: bool
    min_choices: int
    max_choices: int
    sort_order: int
    options: list[dict[str, Any]]

class SlotConfigIn(Schema):
    duration_minutes: int = 60
    capacity: int = 1
    schedule_id: str
    execution_point_id: str
    lead_minutes: int = 0
    horizon_days: int = 14

class BadgeIn(Schema):
    label: dict = {}
    color_role: str = "accent"
    sort_order: int = 0
    is_active: bool = True

class BadgePatch(Schema):
    label: dict | None = None
    color_role: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None

class ItemBadgesIn(Schema):
    badge_ids: list[str] = []

class RouteEntryIn(Schema):
    execution_point_id: str
    is_active: bool = True

class RoutesIn(Schema):
    """Порядок списка = приоритет: первый и есть основной исполнитель."""

    routes: list[RouteEntryIn] = []

class DictEntryIn(Schema):
    title: dict = {}
    code: str | None = None
    is_active: bool = True
    sort_order: int = 100

class DictEntryPatch(Schema):
    title: dict | None = None
    is_active: bool | None = None
    sort_order: int | None = None

class QuickActionsIn(Schema):
    selected: list[str] = []

class SearchSettingsIn(Schema):
    """
    Что участвует в выдаче и что из неё исключено.

    Подсказки — список переводов: одна заготовка на четыре языка. Не строкой:
    «завтрак» по-арабски пишет отель, а не мы.
    """

    services: bool = True
    items: bool = True
    info: bool = True
    excluded_services: list[str] = []
    suggestions: list[dict] = []

class ShowcaseTileIn(Schema):
    """Настройка одной плитки. Все поля, кроме key, необязательны."""

    key: str
    size: str | None = None
    sort_order: int | None = None
    is_enabled: bool | None = None

class ShowcaseSettingsIn(Schema):
    group_threshold: int | None = None
    tiles: list[ShowcaseTileIn] | None = None
