"""
Схемы CMS.

PATCH-эндпоинты разбирают тело через `payload.dict(exclude_unset=True)`:
только так «поле не прислали» отличается от «поле обнулили». Для nullable
полей (`parent_id`, `schedule_id`, `image_id`) разница принципиальна.
"""

from __future__ import annotations

from typing import Any

from ninja import Schema

Translations = dict[str, str]


# --- Общее -----------------------------------------------------------------


class OkOut(Schema):
    ok: bool = True


class ReorderEntry(Schema):
    id: str
    sort_order: int
    parent_id: str | None = None


class ReorderIn(Schema):
    items: list[ReorderEntry]


class ItemsReorderIn(Schema):
    category_id: str
    items: list[ReorderEntry]


class ToggleIn(Schema):
    is_active: bool


class StockIn(Schema):
    in_stock: bool


# --- Аутентификация --------------------------------------------------------


class LoginIn(Schema):
    email: str
    password: str


class StaffUserOut(Schema):
    id: str
    email: str
    full_name: str
    language: str
    is_hotel_admin: bool
    is_platform_admin: bool


class LoginOut(Schema):
    access: str
    refresh: str
    user: StaffUserOut


class MeOut(Schema):
    user: StaffUserOut
    hotel: dict[str, Any]


# --- Bootstrap -------------------------------------------------------------


class BootstrapOut(Schema):
    hotel: dict[str, Any]
    languages: list[dict[str, Any]]
    flags: list[dict[str, Any]]
    allergens: list[dict[str, Any]]
    schedules: list[dict[str, Any]]
    execution_points: list[dict[str, Any]]
    day_parts: list[str]


# --- Категории -------------------------------------------------------------


class CategoryIn(Schema):
    type: str = "product"
    title: Translations
    description: Translations | None = None
    code: str | None = None
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


# --- Блюда -----------------------------------------------------------------


class ItemIn(Schema):
    category_id: str
    type: str = "product"
    location_mode: str | None = None
    title: Translations
    description: Translations | None = None
    content: Translations | None = None
    code: str | None = None
    price: int | None = 0
    flags: list[str] = []
    allergens: list[str] = []
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
    flags: list[str] | None = None
    allergens: list[str] | None = None
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
    flags: list[str]
    allergens: list[str]
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


# --- Поля заявки-услуги -----------------------------------------------------


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


# --- Модификаторы ----------------------------------------------------------


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


# --- Медиа -----------------------------------------------------------------


class MediaOut(Schema):
    id: str
    status: str
    url: str
    thumb_url: str
    original_filename: str


# --- Расписания ------------------------------------------------------------


class ScheduleIntervalIn(Schema):
    weekday: int
    start_time: str
    end_time: str
    day_part: str = ""


class ScheduleIn(Schema):
    name: str
    is_always_open: bool = False
    intervals: list[ScheduleIntervalIn] = []


class SchedulePatch(Schema):
    name: str | None = None
    is_always_open: bool | None = None
    intervals: list[ScheduleIntervalIn] | None = None


class ScheduleOut(Schema):
    id: str
    name: str
    is_always_open: bool
    intervals: list[dict[str, Any]]


# --- Конфигурация брони -----------------------------------------------------


class SlotConfigIn(Schema):
    duration_minutes: int = 60
    capacity: int = 1
    schedule_id: str
    execution_point_id: str
    lead_minutes: int = 0
    horizon_days: int = 14
