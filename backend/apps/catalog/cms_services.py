"""
Сервисный слой CMS-каталога: категории, блюда, модификаторы.

Здесь живут все правила — вьюхи Ninja только разбирают запрос и отдают
результат. Тот же код вызывают тесты и (в будущем) импорт меню из файла.

Тенант нигде не фильтруется руками: менеджеры моделей уже скоупят по текущему
отелю, а RLS страхует на уровне Postgres.
"""

from __future__ import annotations

import uuid
from typing import Any, Iterable

from django.db import transaction
from django.db.models import Count, Q, TextField
from django.db.models.functions import Cast
from django.utils.text import slugify

from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.hotels.models import Hotel, Schedule
from apps.media.models import MediaAsset
from apps.media.services import serialize_asset

from .models import (
    Allergen,
    Badge,
    Category,
    DietaryMarker,
    Item,
    ItemAllergen,
    ItemBadge,
    ItemCharacteristic,
    ItemDietaryMarker,
    ItemImage,
    ModifierGroup,
    ModifierOption,
    OfferingType,
    RequestField,
)
from .offerings import LocationMode, behaviour_for
from .request_fields import BOUNDED_TYPES, FieldType

# Транслитерация для кодов: slugify выбрасывает кириллицу целиком, и «Горячее»
# превратилось бы в пустую строку. Коды попадают в URL и в интеграции, поэтому
# должны быть латиницей и читаемыми.
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


# --- Общие помощники -------------------------------------------------------


def _hotel() -> Hotel:
    return Hotel.objects.get(pk=require_hotel_id())


def transliterate(value: str) -> str:
    return "".join(_TRANSLIT.get(char, char) for char in value.lower())


def make_code(model, title: dict[str, Any] | None, *, prefix: str, extra_filter: dict | None = None) -> str:
    """
    Код из названия: сначала английское, потом любое непустое, с
    транслитерацией. Уникальность обеспечивается суффиксом.
    """
    title = title or {}
    source = title.get("en") or next((v for v in title.values() if v), "")
    base = slugify(transliterate(str(source)))[:48] or f"{prefix}-{uuid.uuid4().hex[:6]}"

    queryset = model.all_objects.filter(**(extra_filter or {}))
    candidate = base
    suffix = 2
    while queryset.filter(code=candidate).exists():
        candidate = f"{base}-{suffix}"[:64]
        suffix += 1
    return candidate


def clean_translations(value: Any, *, field: str) -> dict[str, str]:
    """Приводит переводимое поле к {lang: str}, выкидывая пустые языки."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError(
            "Переводимое поле должно быть объектом {язык: значение}", field=field
        )
    return {
        str(lang): str(text).strip()
        for lang, text in value.items()
        if text is not None and str(text).strip()
    }


def require_translation(value: dict[str, str], *, field: str) -> dict[str, str]:
    """
    Хотя бы один язык обязан быть заполнен. Требовать именно язык отеля по
    умолчанию было бы слишком жёстко: отель может заводить меню сразу на
    английском, а русский добавлять потом.
    """
    if not value:
        raise ValidationError("Заполните название хотя бы на одном языке", field=field)
    return value


def _resolve_schedule(schedule_id: Any) -> Schedule | None:
    if not schedule_id:
        return None
    schedule = Schedule.objects.filter(pk=schedule_id).first()
    if schedule is None:
        raise ValidationError("Расписание не найдено", field="schedule_id")
    return schedule


def _resolve_asset(asset_id: Any) -> MediaAsset | None:
    if not asset_id:
        return None
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise ValidationError("Изображение не найдено", field="image_id")
    return asset


def _next_sort_order(queryset) -> int:
    last = queryset.order_by("-sort_order").values_list("sort_order", flat=True).first()
    return (last or 0) + 1 if last is not None else 0


# ===========================================================================
# Категории
# ===========================================================================


def serialize_category(
    category: Category, *, counts: dict | None = None, with_children: bool = False
) -> dict:
    counts = counts or {}
    payload = {
        "id": str(category.pk),
        "parent_id": str(category.parent_id) if category.parent_id else None,
        "code": category.code,
        "type": category.type,
        "title": category.title or {},
        "description": category.description or {},
        "image": serialize_asset(category.image),
        "schedule_id": str(category.schedule_id) if category.schedule_id else None,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
        "items_count": counts.get(category.pk, 0),
        "service_fee_applies": category.service_fee_applies,
        "min_order_minor": category.min_order_minor,
    }
    if with_children:
        payload["children"] = []
    return payload


def category_tree(offering_type: str = OfferingType.PRODUCT) -> list[dict]:
    """Дерево категорий с числом позиций. Один запрос на уровень, без N+1."""
    categories = list(
        Category.objects.filter(type=offering_type)
        .select_related("image")
        .order_by("sort_order", "code")
    )
    counts = dict(
        Category.objects.filter(type=offering_type)
        .annotate(n=Count("items", filter=Q(items__deleted_at__isnull=True)))
        .values_list("pk", "n")
    )

    nodes = {
        category.pk: serialize_category(category, counts=counts, with_children=True)
        for category in categories
    }
    roots: list[dict] = []
    for category in categories:
        node = nodes[category.pk]
        parent = nodes.get(category.parent_id) if category.parent_id else None
        if parent is None:
            roots.append(node)
        else:
            parent["children"].append(node)
    return roots


def get_category(category_id) -> Category:
    category = Category.objects.select_related("image").filter(pk=category_id).first()
    if category is None:
        raise NotFoundError("Категория не найдена")
    return category


def _validate_parent(category_id, parent_id) -> Category | None:
    """Родитель существует и не является потомком самой категории (иначе цикл)."""
    if not parent_id:
        return None
    parent = Category.objects.filter(pk=parent_id).first()
    if parent is None:
        raise ValidationError("Родительская категория не найдена", field="parent_id")
    if category_id and str(parent.pk) == str(category_id):
        raise ValidationError(
            "Категория не может быть своим родителем", field="parent_id", code="cycle_detected"
        )

    cursor = parent
    seen = set()
    while cursor.parent_id:
        if cursor.parent_id in seen:
            break
        seen.add(cursor.parent_id)
        if category_id and str(cursor.parent_id) == str(category_id):
            raise ValidationError(
                "Нельзя перенести категорию внутрь её же потомка",
                field="parent_id",
                code="cycle_detected",
            )
        cursor = Category.objects.filter(pk=cursor.parent_id).first()
        if cursor is None:
            break
    return parent


@transaction.atomic
def create_category(data: dict) -> Category:
    title = require_translation(clean_translations(data.get("title"), field="title"), field="title")
    parent = _validate_parent(None, data.get("parent_id"))

    category = Category.objects.create(
        type=data.get("type") or OfferingType.PRODUCT,
        code=data.get("code") or make_code(Category, title, prefix="category"),
        title=title,
        description=clean_translations(data.get("description"), field="description"),
        parent=parent,
        image=_resolve_asset(data.get("image_id")),
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(Category.objects.filter(parent=parent)),
        is_active=data.get("is_active", True),
    )
    return category


@transaction.atomic
def update_category(category_id, data: dict) -> Category:
    category = get_category(category_id)

    if "title" in data:
        category.title = require_translation(
            clean_translations(data["title"], field="title"), field="title"
        )
    if "description" in data:
        category.description = clean_translations(data["description"], field="description")
    if "parent_id" in data:
        category.parent = _validate_parent(category.pk, data["parent_id"])
    if "image_id" in data:
        category.image = _resolve_asset(data["image_id"])
    if "schedule_id" in data:
        category.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data and data["sort_order"] is not None:
        category.sort_order = data["sort_order"]
    if "is_active" in data:
        category.is_active = data["is_active"]
    if "service_fee_applies" in data:
        category.service_fee_applies = bool(data["service_fee_applies"])
    if "min_order_minor" in data:
        category.min_order_minor = _validate_min_order(data["min_order_minor"])
    if data.get("code"):
        category.code = data["code"]

    category.save()
    return category


@transaction.atomic
def delete_category(category_id, *, cascade: bool = False) -> None:
    category = get_category(category_id)
    items_count = Item.objects.filter(category=category).count()
    children_count = Category.objects.filter(parent=category).count()

    if (items_count or children_count) and not cascade:
        raise ConflictError(
            "В категории есть блюда или подкатегории",
            code="category_not_empty",
            items_count=items_count,
            children_count=children_count,
        )

    if cascade:
        for child in Category.objects.filter(parent=category):
            delete_category(child.pk, cascade=True)
        for item in Item.objects.filter(category=category):
            delete_item(item.pk)

    category.delete()


@transaction.atomic
def reorder_categories(entries: Iterable[dict]) -> list[dict]:
    """
    Полный новый порядок затронутых узлов, одной транзакцией. Клиент шлёт то,
    что видит после drag-and-drop, а не дельту — так проще и надёжнее.
    """
    entries = list(entries)
    ids = [entry["id"] for entry in entries]
    categories = {str(c.pk): c for c in Category.objects.filter(pk__in=ids)}
    if len(categories) != len(set(map(str, ids))):
        raise ValidationError("В списке есть неизвестные категории", field="items")

    for entry in entries:
        category = categories[str(entry["id"])]
        parent_id = entry.get("parent_id")
        if str(category.parent_id or "") != str(parent_id or ""):
            category.parent = _validate_parent(category.pk, parent_id)
        category.sort_order = entry["sort_order"]
        category.save(update_fields=["parent", "sort_order", "updated_at"])

    return category_tree(_tree_type(categories.values()))


def _tree_type(categories) -> str:
    """Пересортировка идёт внутри одного типа — берём его у любой категории."""
    first = next(iter(categories), None)
    return first.type if first is not None else OfferingType.PRODUCT


def toggle_category(category_id, *, is_active: bool) -> Category:
    category = get_category(category_id)
    category.is_active = is_active
    category.save(update_fields=["is_active", "updated_at"])
    return category


# ===========================================================================
# Блюда
# ===========================================================================


def serialize_item(item: Item, *, with_modifiers: bool = False) -> dict:
    payload = {
        "id": str(item.pk),
        "category_id": str(item.category_id),
        "code": item.code,
        "type": item.type,
        "location_mode": item.location_mode,
        "content": item.content or {},
        "title": item.title or {},
        "description": item.description or {},
        "price": item.price,
        "images": [
            {
                **(serialize_asset(link.asset) or {}),
                "sort_order": link.sort_order,
            }
            for link in item.images.all()
        ],
        # Аллергены/маркеры/характеристики — из словарей (join). Легаси-массивы
        # flags/allergens удалены вместе с колонками.
        "allergen_ids": [str(link.allergen_id) for link in item.item_allergens.all()],
        "marker_ids": [str(link.marker_id) for link in item.item_markers.all()],
        "characteristics": [
            {"name": c.name or {}, "value": c.value or {}}
            for c in item.characteristics.all()
        ],
        "prep_minutes": item.prep_minutes,
        "badges": [
            {"id": str(link.badge_id), "sort_order": link.sort_order}
            for link in item.item_badges.all()
        ],
        "schedule_id": str(item.schedule_id) if item.schedule_id else None,
        "sort_order": item.sort_order,
        "is_active": item.is_active,
        "in_stock": item.in_stock,
    }
    if with_modifiers:
        # Оба блока приезжают всегда, лишний просто пуст: редактор смотрит на
        # содержимое, а не разветвляется по типу на каждом обращении.
        payload["modifier_groups"] = [
            serialize_modifier_group(group) for group in item.modifier_groups.all()
        ]
        payload["request_fields"] = [
            serialize_request_field(entry) for entry in item.request_fields.all()
        ]
    return payload


def _item_queryset(offering_type: str | None = None):
    queryset = Item.objects.select_related("category").prefetch_related("images__asset")
    if offering_type:
        queryset = queryset.filter(type=offering_type)
    return queryset


def list_items(*, category_id=None, search: str = "", offering_type: str | None = None) -> list[dict]:
    queryset = _item_queryset(offering_type)
    if category_id:
        queryset = queryset.filter(category_id=category_id)
    if search:
        # Поиск сразу по всем языкам: title — JSONB, поэтому приводим его к
        # тексту и ищем подстроку. Для CMS с сотнями позиций этого достаточно;
        # полнотекстовый индекс приедет вместе с масштабом.
        queryset = queryset.annotate(title_text=Cast("title", TextField())).filter(
            Q(title_text__icontains=search) | Q(code__icontains=search)
        )
    return [serialize_item(item) for item in queryset.order_by("sort_order", "code")]


def get_item(item_id, *, with_modifiers: bool = False) -> Item:
    queryset = _item_queryset()
    if with_modifiers:
        queryset = queryset.prefetch_related("modifier_groups__options", "request_fields")
    item = queryset.filter(pk=item_id).first()
    if item is None:
        raise NotFoundError("Блюдо не найдено")
    return item


def _validate_price(price: Any) -> int | None:
    """None — «цена не указана» (у уборки её нет), а не «бесплатно»."""
    if price is None:
        return None
    try:
        value = int(price)
    except (TypeError, ValueError):
        raise ValidationError("Цена должна быть целым числом копеек", field="price") from None
    if value < 0:
        raise ValidationError("Цена не может быть отрицательной", field="price")
    return value


def _validate_min_order(value: Any) -> int | None:
    """None — «нет порога». Иначе неотрицательные копейки."""
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError(
            "Минимальная сумма — неотрицательное целое копеек",
            field="min_order_minor",
            code="out_of_range",
        )
    return value


def _validate_prep_minutes(value: Any) -> int | None:
    """None — «не показывать чип времени подачи». Иначе неотрицательные минуты."""
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError(
            "Время подачи — неотрицательное целое минут",
            field="prep_minutes",
            code="out_of_range",
        )
    return value


def _resolve_category(category_id) -> Category:
    if not category_id:
        raise ValidationError("Выберите категорию", field="category_id")
    category = Category.objects.filter(pk=category_id).first()
    if category is None:
        raise ValidationError("Категория не найдена", field="category_id")
    return category


@transaction.atomic
def create_item(data: dict) -> Item:
    title = require_translation(clean_translations(data.get("title"), field="title"), field="title")
    category = _resolve_category(data.get("category_id"))

    offering_type = data.get("type") or OfferingType.PRODUCT
    if offering_type not in dict(OfferingType.choices):
        raise ValidationError(f"Неизвестный тип позиции: {offering_type}", field="type")
    behaviour = behaviour_for(offering_type)

    item = Item.objects.create(
        type=offering_type,
        location_mode=data.get("location_mode") or behaviour.default_location_mode,
        category=category,
        code=data.get("code") or make_code(Item, title, prefix="item"),
        title=title,
        description=clean_translations(data.get("description"), field="description"),
        content=clean_translations(data.get("content"), field="content"),
        price=_validate_price(data.get("price")),
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(Item.objects.filter(category=category)),
        is_active=data.get("is_active", True),
        in_stock=data.get("in_stock", True),
    )
    if data.get("image_ids"):
        set_item_images(item.pk, data["image_ids"])
    _apply_item_facets(item, data)
    return item


@transaction.atomic
def update_item(item_id, data: dict) -> Item:
    item = get_item(item_id)

    if "title" in data:
        item.title = require_translation(
            clean_translations(data["title"], field="title"), field="title"
        )
    if "description" in data:
        item.description = clean_translations(data["description"], field="description")
    if "content" in data:
        item.content = clean_translations(data["content"], field="content")
    if "category_id" in data:
        item.category = _resolve_category(data["category_id"])
    if "type" in data and data["type"] and data["type"] != item.type:
        # Тип задаётся при создании и дальше неизменен: у товара модификаторы и
        # корзина, у заявки — поля и форма. Переключение осиротило бы одно из
        # двух и оставило заказы, ссылающиеся на исчезнувшую механику.
        raise ValidationError(
            "Тип позиции нельзя изменить после создания", field="type", code="type_immutable"
        )
    if "location_mode" in data and data["location_mode"]:
        item.location_mode = data["location_mode"]
    if "price" in data:
        item.price = _validate_price(data["price"])
    if "schedule_id" in data:
        item.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data and data["sort_order"] is not None:
        item.sort_order = data["sort_order"]
    if "is_active" in data:
        item.is_active = data["is_active"]
    if "in_stock" in data:
        item.in_stock = data["in_stock"]
    if "prep_minutes" in data:
        item.prep_minutes = _validate_prep_minutes(data["prep_minutes"])
    if data.get("code"):
        item.code = data["code"]

    item.save()
    if "image_ids" in data:
        set_item_images(item.pk, data["image_ids"] or [])
    _apply_item_facets(item, data)
    return item


@transaction.atomic
def delete_item(item_id) -> None:
    item = get_item(item_id)
    # Позиции заказов ссылаются на Item через PROTECT, поэтому удаление именно
    # мягкое: история заказов обязана пережить удаление блюда из меню.
    ItemImage.objects.filter(item=item).delete()
    ModifierOption.objects.filter(group__item=item).delete()
    ModifierGroup.objects.filter(item=item).delete()
    RequestField.objects.filter(item=item).delete()
    item.delete()


@transaction.atomic
def reorder_items(*, category_id, entries: Iterable[dict]) -> list[dict]:
    entries = list(entries)
    ids = [entry["id"] for entry in entries]
    items = {str(i.pk): i for i in Item.objects.filter(pk__in=ids, category_id=category_id)}
    if len(items) != len(set(map(str, ids))):
        raise ValidationError("В списке есть блюда из другой категории", field="items")

    for entry in entries:
        item = items[str(entry["id"])]
        item.sort_order = entry["sort_order"]
        item.save(update_fields=["sort_order", "updated_at"])

    return list_items(category_id=category_id)


def set_item_stock(item_id, *, in_stock: bool) -> Item:
    item = get_item(item_id)
    item.in_stock = in_stock
    item.save(update_fields=["in_stock", "updated_at"])
    return item


def toggle_item(item_id, *, is_active: bool) -> Item:
    item = get_item(item_id)
    item.is_active = is_active
    item.save(update_fields=["is_active", "updated_at"])
    return item


@transaction.atomic
def set_item_images(item_id, image_ids: list[str]) -> Item:
    """Полная замена набора картинок: порядок задаётся порядком списка."""
    item = get_item(item_id)
    assets = {str(a.pk): a for a in MediaAsset.objects.filter(pk__in=image_ids)}
    unknown = [str(i) for i in image_ids if str(i) not in assets]
    if unknown:
        raise ValidationError("Изображение не найдено", field="image_ids")

    # Связки картинок — служебные строки, их незачем хранить мягко.
    ItemImage.objects.filter(item=item).hard_delete()
    for index, asset_id in enumerate(image_ids):
        ItemImage.objects.create(item=item, asset=assets[str(asset_id)], sort_order=index)
    return get_item(item_id)


# ===========================================================================
# Модификаторы
# ===========================================================================


def serialize_modifier_group(group: ModifierGroup) -> dict:
    return {
        "id": str(group.pk),
        "item_id": str(group.item_id),
        "code": group.code,
        "title": group.title or {},
        "selection": group.selection,
        "is_required": group.is_required,
        "min_choices": group.min_choices,
        "max_choices": group.max_choices,
        "sort_order": group.sort_order,
        "options": [serialize_modifier_option(o) for o in group.options.all()],
    }


def serialize_modifier_option(option: ModifierOption) -> dict:
    return {
        "id": str(option.pk),
        "group_id": str(option.group_id),
        "code": option.code,
        "title": option.title or {},
        "price_delta": option.price_delta,
        "is_default": option.is_default,
        "is_active": option.is_active,
        "sort_order": option.sort_order,
    }


def get_modifier_group(group_id) -> ModifierGroup:
    group = (
        ModifierGroup.objects.select_related("item")
        .prefetch_related("options")
        .filter(pk=group_id)
        .first()
    )
    if group is None:
        raise NotFoundError("Группа модификаторов не найдена")
    return group


def _normalize_group_rules(group: ModifierGroup) -> None:
    """
    Приводит правила выбора к непротиворечивому виду.

    Делается на сервере, а не только в форме: правила определяют, что кухня
    получит в заказе, и полагаться на дисциплину клиента здесь нельзя.
    """
    if group.selection == ModifierGroup.Selection.SINGLE:
        group.max_choices = 1
        if group.is_required:
            group.min_choices = 1
        else:
            group.min_choices = min(group.min_choices, 1)

    if group.is_required and group.min_choices < 1:
        group.min_choices = 1
    if not group.is_required:
        group.min_choices = min(group.min_choices, group.max_choices)

    if group.max_choices < 1:
        raise ValidationError(
            "Максимум вариантов должен быть не меньше 1", field="max_choices"
        )
    if group.min_choices > group.max_choices:
        raise ValidationError(
            "Минимум вариантов не может превышать максимум", field="min_choices"
        )


def _validate_group_consistency(group: ModifierGroup) -> None:
    """Проверка, требующая знать состав опций — вызывается после их изменения."""
    active = group.options.filter(is_active=True).count()
    if group.is_required and active == 0:
        raise ValidationError(
            "Обязательная группа не может быть пустой — добавьте варианты",
            field="options",
            code="required_group_empty",
        )
    if group.min_choices > active and active > 0:
        raise ValidationError(
            f"В группе только {active} активных вариантов — минимум не может быть больше",
            field="min_choices",
            code="not_enough_options",
        )


@transaction.atomic
def create_modifier_group(item_id, data: dict) -> ModifierGroup:
    item = get_item(item_id)
    title = require_translation(clean_translations(data.get("title"), field="title"), field="title")

    group = ModifierGroup(
        item=item,
        code=data.get("code")
        or make_code(ModifierGroup, title, prefix="group", extra_filter={"item": item}),
        title=title,
        selection=data.get("selection", ModifierGroup.Selection.SINGLE),
        is_required=data.get("is_required", False),
        min_choices=data.get("min_choices", 0),
        max_choices=data.get("max_choices", 1),
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(ModifierGroup.objects.filter(item=item)),
    )
    _normalize_group_rules(group)
    group.hotel_id = item.hotel_id
    group.save()

    for index, option in enumerate(data.get("options") or []):
        create_modifier_option(group.pk, {**option, "sort_order": option.get("sort_order", index)},
                               skip_consistency_check=True)
    group.refresh_from_db()
    return get_modifier_group(group.pk)


@transaction.atomic
def update_modifier_group(group_id, data: dict) -> ModifierGroup:
    group = get_modifier_group(group_id)

    if "title" in data:
        group.title = require_translation(
            clean_translations(data["title"], field="title"), field="title"
        )
    if "selection" in data:
        group.selection = data["selection"]
    if "is_required" in data:
        group.is_required = data["is_required"]
    if "min_choices" in data and data["min_choices"] is not None:
        group.min_choices = data["min_choices"]
    if "max_choices" in data and data["max_choices"] is not None:
        group.max_choices = data["max_choices"]
    if "sort_order" in data and data["sort_order"] is not None:
        group.sort_order = data["sort_order"]
    if data.get("code"):
        group.code = data["code"]

    _normalize_group_rules(group)
    group.save()
    _validate_group_consistency(group)
    return get_modifier_group(group.pk)


@transaction.atomic
def delete_modifier_group(group_id) -> None:
    group = get_modifier_group(group_id)
    ModifierOption.objects.filter(group=group).delete()
    group.delete()


@transaction.atomic
def reorder_modifier_groups(item_id, entries: Iterable[dict]) -> list[dict]:
    item = get_item(item_id, with_modifiers=True)
    entries = list(entries)
    groups = {str(g.pk): g for g in ModifierGroup.objects.filter(item=item)}
    for entry in entries:
        group = groups.get(str(entry["id"]))
        if group is None:
            raise ValidationError("Группа не принадлежит этому блюду", field="items")
        group.sort_order = entry["sort_order"]
        group.save(update_fields=["sort_order", "updated_at"])
    return [serialize_modifier_group(g) for g in get_item(item_id, with_modifiers=True).modifier_groups.all()]


# --- Опции -----------------------------------------------------------------


def get_modifier_option(option_id) -> ModifierOption:
    option = ModifierOption.objects.select_related("group").filter(pk=option_id).first()
    if option is None:
        raise NotFoundError("Вариант не найден")
    return option


def _validate_price_delta(value: Any) -> int:
    if value is None:
        return 0
    try:
        # Надбавка может быть отрицательной: «без гарнира — минус 100 ₽».
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError(
            "Надбавка должна быть целым числом копеек", field="price_delta"
        ) from None


@transaction.atomic
def create_modifier_option(group_id, data: dict, *, skip_consistency_check: bool = False) -> ModifierOption:
    group = get_modifier_group(group_id)
    title = require_translation(clean_translations(data.get("title"), field="title"), field="title")

    option = ModifierOption.objects.create(
        hotel_id=group.hotel_id,
        group=group,
        code=data.get("code")
        or make_code(ModifierOption, title, prefix="option", extra_filter={"group": group}),
        title=title,
        price_delta=_validate_price_delta(data.get("price_delta")),
        is_default=data.get("is_default", False),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(ModifierOption.objects.filter(group=group)),
    )
    if option.is_default and group.selection == ModifierGroup.Selection.SINGLE:
        ModifierOption.objects.filter(group=group).exclude(pk=option.pk).update(is_default=False)
    if not skip_consistency_check:
        _validate_group_consistency(get_modifier_group(group.pk))
    return option


@transaction.atomic
def update_modifier_option(option_id, data: dict) -> ModifierOption:
    option = get_modifier_option(option_id)

    if "title" in data:
        option.title = require_translation(
            clean_translations(data["title"], field="title"), field="title"
        )
    if "price_delta" in data:
        option.price_delta = _validate_price_delta(data["price_delta"])
    if "is_default" in data:
        option.is_default = data["is_default"]
    if "is_active" in data:
        option.is_active = data["is_active"]
    if "sort_order" in data and data["sort_order"] is not None:
        option.sort_order = data["sort_order"]
    if data.get("code"):
        option.code = data["code"]

    option.save()
    if option.is_default and option.group.selection == ModifierGroup.Selection.SINGLE:
        ModifierOption.objects.filter(group=option.group).exclude(pk=option.pk).update(
            is_default=False
        )
    _validate_group_consistency(get_modifier_group(option.group_id))
    return option


@transaction.atomic
def delete_modifier_option(option_id) -> None:
    option = get_modifier_option(option_id)
    group_id = option.group_id
    option.delete()
    _validate_group_consistency(get_modifier_group(group_id))


@transaction.atomic
def reorder_modifier_options(group_id, entries: Iterable[dict]) -> list[dict]:
    group = get_modifier_group(group_id)
    options = {str(o.pk): o for o in ModifierOption.objects.filter(group=group)}
    for entry in entries:
        option = options.get(str(entry["id"]))
        if option is None:
            raise ValidationError("Вариант не принадлежит этой группе", field="items")
        option.sort_order = entry["sort_order"]
        option.save(update_fields=["sort_order", "updated_at"])
    return [serialize_modifier_option(o) for o in get_modifier_group(group_id).options.all()]


# ===========================================================================
# Поля заявки-услуги
#
# Устроено по образцу модификаторов: та же форма CRUD, та же сортировка, те же
# правила «сервер проверяет, а не только форма». Разница в том, что модификатор
# меняет цену, а поле — содержание работы исполнителя.
# ===========================================================================


def serialize_request_field(entry: RequestField) -> dict:
    return {
        "id": str(entry.pk),
        "item_id": str(entry.item_id),
        "code": entry.code,
        "label": entry.label or {},
        "help_text": entry.help_text or {},
        "field_type": entry.field_type,
        "is_required": entry.is_required,
        "options": list(entry.options or []),
        "min_value": entry.min_value,
        "max_value": entry.max_value,
        "sort_order": entry.sort_order,
    }


def get_request_field(field_id) -> RequestField:
    entry = RequestField.objects.select_related("item").filter(pk=field_id).first()
    if entry is None:
        raise NotFoundError("Поле заявки не найдено")
    return entry


def _require_service_item(item: Item) -> None:
    """Поля есть только у заявок — так же, как модификаторы только у товаров."""
    if not behaviour_for(item.type).uses_fields:
        raise ValidationError(
            "У позиции этого типа нет полей заявки",
            field="type",
            code="fields_not_supported",
        )


def _clean_options(raw: Any, field_type: str) -> list[dict]:
    """
    Варианты нужны только `select`, и без них поле было бы неотвечаемым:
    гость увидел бы пустой список и не смог отправить заявку.
    """
    options = []
    for index, option in enumerate(raw or []):
        value = str((option or {}).get("value", "")).strip()
        if not value:
            raise ValidationError(
                "У варианта должно быть значение", field=f"options.{index}.value"
            )
        options.append(
            {
                "value": value,
                "label": clean_translations(option.get("label"), field=f"options.{index}.label"),
            }
        )

    if field_type == FieldType.SELECT and not options:
        raise ValidationError(
            "Список вариантов не может быть пустым",
            field="options",
            code="select_without_options",
        )
    if field_type != FieldType.SELECT and options:
        raise ValidationError(
            "Варианты задаются только для поля типа «выбор из списка»", field="options"
        )
    return options


def _clean_bounds(data: dict, field_type: str, current: RequestField | None = None) -> tuple[int | None, int | None]:
    minimum = data.get("min_value", current.min_value if current else None)
    maximum = data.get("max_value", current.max_value if current else None)

    if field_type not in BOUNDED_TYPES:
        # Границы у текста или даты — бессмыслица, которая потом всплывёт
        # непонятной ошибкой у гостя. Гасим сразу.
        if minimum is not None or maximum is not None:
            raise ValidationError(
                "Границы задаются только для числа и количества", field="min_value"
            )
        return None, None

    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValidationError(
            "Минимум больше максимума", field="min_value", code="invalid_range"
        )
    return minimum, maximum


@transaction.atomic
def create_request_field(item_id, data: dict) -> RequestField:
    item = get_item(item_id)
    _require_service_item(item)

    label = require_translation(clean_translations(data.get("label"), field="label"), field="label")
    field_type = data.get("field_type") or FieldType.TEXT
    if field_type not in dict(FieldType.choices):
        raise ValidationError(f"Неизвестный тип поля: {field_type}", field="field_type")

    options = _clean_options(data.get("options"), field_type)
    minimum, maximum = _clean_bounds(data, field_type)

    return RequestField.objects.create(
        hotel_id=item.hotel_id,
        item=item,
        code=data.get("code")
        or make_code(RequestField, label, prefix="field", extra_filter={"item": item}),
        label=label,
        help_text=clean_translations(data.get("help_text"), field="help_text"),
        field_type=field_type,
        is_required=data.get("is_required", False),
        options=options,
        min_value=minimum,
        max_value=maximum,
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(RequestField.objects.filter(item=item)),
    )


@transaction.atomic
def update_request_field(field_id, data: dict) -> RequestField:
    entry = get_request_field(field_id)

    if "label" in data:
        entry.label = require_translation(
            clean_translations(data["label"], field="label"), field="label"
        )
    if "help_text" in data:
        entry.help_text = clean_translations(data["help_text"], field="help_text")
    if "field_type" in data and data["field_type"]:
        if data["field_type"] not in dict(FieldType.choices):
            raise ValidationError(f"Неизвестный тип поля: {data['field_type']}", field="field_type")
        entry.field_type = data["field_type"]
    if "is_required" in data:
        entry.is_required = data["is_required"]
    if "sort_order" in data and data["sort_order"] is not None:
        entry.sort_order = data["sort_order"]
    if data.get("code"):
        entry.code = data["code"]

    entry.options = _clean_options(
        data.get("options", entry.options), entry.field_type
    )
    entry.min_value, entry.max_value = _clean_bounds(data, entry.field_type, entry)

    entry.save()
    return entry


@transaction.atomic
def delete_request_field(field_id) -> None:
    get_request_field(field_id).delete()


@transaction.atomic
def reorder_request_fields(item_id, entries: Iterable[dict]) -> list[dict]:
    item = get_item(item_id)
    known = {str(entry.pk): entry for entry in RequestField.objects.filter(item=item)}
    for entry in entries:
        stored = known.get(str(entry["id"]))
        if stored is None:
            raise ValidationError("Поле не принадлежит этой позиции", field="items")
        stored.sort_order = entry["sort_order"]
        stored.save(update_fields=["sort_order", "updated_at"])
    return [
        serialize_request_field(entry)
        for entry in RequestField.objects.filter(item=item).order_by("sort_order", "code")
    ]


# ===========================================================================
# Конфигурация брони (тип slot)
# ===========================================================================


def serialize_slot_config(config) -> dict:
    return {
        "id": str(config.pk),
        "item_id": str(config.item_id),
        "duration_minutes": config.duration_minutes,
        "capacity": config.capacity,
        "schedule_id": str(config.schedule_id),
        "execution_point_id": str(config.execution_point_id),
        "lead_minutes": config.lead_minutes,
        "horizon_days": config.horizon_days,
    }


def get_slot_config(item_id) -> dict | None:
    from .models import SlotConfig

    config = SlotConfig.objects.filter(item_id=item_id).first()
    return serialize_slot_config(config) if config else None


@transaction.atomic
def upsert_slot_config(item_id, data: dict) -> dict:
    from apps.hotels.models import ExecutionPoint, Schedule

    from .models import SlotConfig
    from .offerings import behaviour_for

    item = get_item(item_id)
    if not behaviour_for(item.type).uses_slots:
        raise ValidationError(
            "Бронь настраивается только у позиций типа «слот»",
            field="type",
            code="slots_not_supported",
        )

    duration = data.get("duration_minutes", 60)
    if duration is None or duration < 5:
        raise ValidationError("Длительность слота не меньше 5 минут", field="duration_minutes")
    capacity = data.get("capacity", 1)
    if capacity is None or capacity < 1:
        raise ValidationError("Вместимость не меньше 1", field="capacity")

    schedule = Schedule.objects.filter(pk=data.get("schedule_id")).first()
    if schedule is None:
        raise ValidationError("Выберите рабочее расписание", field="schedule_id")
    point = ExecutionPoint.objects.filter(pk=data.get("execution_point_id")).first()
    if point is None:
        raise ValidationError("Выберите отдел-исполнитель", field="execution_point_id")

    config, _ = SlotConfig.objects.update_or_create(
        item=item,
        defaults={
            "duration_minutes": duration,
            "capacity": capacity,
            "schedule": schedule,
            "execution_point": point,
            "lead_minutes": data.get("lead_minutes", 0),
            "horizon_days": data.get("horizon_days", 14),
        },
    )
    return serialize_slot_config(config)


# --- Маркетинговые бейджи ---------------------------------------------------

_BADGE_ROLES = {choice.value for choice in Badge.ColorRole}


def serialize_badge(badge: Badge) -> dict:
    return {
        "id": str(badge.pk),
        "label": badge.label or {},
        "color_role": badge.color_role,
        "sort_order": badge.sort_order,
        "is_active": badge.is_active,
        "preset": badge.preset,
    }


def list_badges() -> list[dict]:
    return [serialize_badge(b) for b in Badge.objects.all().order_by("sort_order", "id")]


def _validate_role(role: str) -> str:
    if role not in _BADGE_ROLES:
        raise ValidationError(
            f"Недопустимая роль цвета «{role}»", field="color_role", code="invalid_color_role"
        )
    return role


def create_badge(data: dict) -> Badge:
    label = data.get("label") or {}
    if not any((label.get(lang) or "").strip() for lang in label):
        raise ValidationError("Название бейджа обязательно", field="label")
    badge = Badge.objects.create(
        hotel_id=require_hotel_id(),
        label=label,
        color_role=_validate_role(data.get("color_role", Badge.ColorRole.ACCENT)),
        sort_order=int(data.get("sort_order", 0)),
        is_active=bool(data.get("is_active", True)),
    )
    return badge


def update_badge(badge_id, data: dict) -> Badge:
    badge = Badge.objects.filter(pk=badge_id).first()
    if badge is None:
        raise NotFoundError("Бейдж не найден")
    if "label" in data:
        badge.label = data["label"] or {}
    if "color_role" in data:
        badge.color_role = _validate_role(data["color_role"])
    if "sort_order" in data:
        badge.sort_order = int(data["sort_order"])
    if "is_active" in data:
        badge.is_active = bool(data["is_active"])
    badge.save()
    return badge


def delete_badge(badge_id) -> None:
    badge = Badge.objects.filter(pk=badge_id).first()
    if badge is None:
        raise NotFoundError("Бейдж не найден")
    # Назначения снимаем жёстко (join), сам бейдж — мягко.
    ItemBadge.objects.filter(badge=badge).hard_delete()
    badge.delete()


def assign_item_badges(item_id, badge_ids: list) -> list[dict]:
    """Заменяет набор бейджей позиции. Join-строки удаляем жёстко."""
    item = Item.objects.filter(pk=item_id).first()
    if item is None:
        raise NotFoundError("Позиция не найдена")

    valid = list(Badge.objects.filter(pk__in=badge_ids).values_list("pk", flat=True))
    ItemBadge.objects.filter(item=item).hard_delete()
    for order, badge_id in enumerate(badge_ids):
        if badge_id in {str(v) for v in valid} or badge_id in valid:
            ItemBadge.objects.create(
                hotel_id=item.hotel_id, item=item, badge_id=badge_id, sort_order=order
            )
    return [
        {"id": str(link.badge_id), "sort_order": link.sort_order}
        for link in item.item_badges.all().order_by("sort_order")
    ]


# --- Справочники аллергенов и маркеров ---------------------------------------


def _serialize_dict_entry(row) -> dict:
    return {
        "id": str(row.pk),
        "code": row.code,
        "title": row.title or {},
        "is_system": row.is_system,
        "is_active": row.is_active,
        "sort_order": row.sort_order,
    }


def list_allergens() -> list[dict]:
    return [_serialize_dict_entry(a) for a in Allergen.objects.all()]


def list_markers() -> list[dict]:
    return [_serialize_dict_entry(m) for m in DietaryMarker.objects.all()]


def _create_dict_entry(model, data: dict, *, prefix: str):
    title = clean_translations(data.get("title"), field="title")
    if not any((title.get(lang) or "").strip() for lang in title):
        raise ValidationError("Название обязательно", field="title")
    code = data.get("code") or make_code(model, title, prefix=prefix)
    if model.objects.filter(code=code).exists():
        raise ConflictError("Код уже используется", code="code_exists")
    return model.objects.create(
        hotel_id=require_hotel_id(),
        code=code,
        title=title,
        is_system=False,  # созданное отелем — не системное, его можно удалить
        is_active=bool(data.get("is_active", True)),
        sort_order=int(data.get("sort_order", 100)),
    )


def _update_dict_entry(model, entry_id, data: dict):
    row = model.objects.filter(pk=entry_id).first()
    if row is None:
        raise NotFoundError("Запись справочника не найдена")
    if "title" in data:
        row.title = clean_translations(data["title"], field="title")
    if "is_active" in data:
        row.is_active = bool(data["is_active"])
    if "sort_order" in data:
        row.sort_order = int(data["sort_order"])
    row.save()
    return row


def _delete_dict_entry(model, join_model, join_field: str, entry_id) -> None:
    row = model.objects.filter(pk=entry_id).first()
    if row is None:
        raise NotFoundError("Запись справочника не найдена")
    if row.is_system:
        # Системные 14 аллергенов / маркеры не удаляем — только деактивируем.
        raise ConflictError(
            "Системную запись нельзя удалить — отключите её", code="system_protected"
        )
    join_model.objects.filter(**{join_field: row}).hard_delete()
    row.delete()


def create_allergen(data: dict):
    return _create_dict_entry(Allergen, data, prefix="allergen")


def update_allergen(entry_id, data: dict):
    return _update_dict_entry(Allergen, entry_id, data)


def delete_allergen(entry_id) -> None:
    _delete_dict_entry(Allergen, ItemAllergen, "allergen", entry_id)


def create_marker(data: dict):
    return _create_dict_entry(DietaryMarker, data, prefix="marker")


def update_marker(entry_id, data: dict):
    return _update_dict_entry(DietaryMarker, entry_id, data)


def delete_marker(entry_id) -> None:
    _delete_dict_entry(DietaryMarker, ItemDietaryMarker, "marker", entry_id)


# --- Назначение аллергенов/маркеров/характеристик позиции --------------------


def _sync_join(item, join_model, fk: str, dict_model, ids: list) -> None:
    """Заменяет набор связей позиции. Join-строки удаляем жёстко (как ItemBadge)."""
    valid = {str(v) for v in dict_model.objects.filter(pk__in=ids).values_list("pk", flat=True)}
    join_model.objects.filter(item=item).hard_delete()
    seen = set()
    for entry_id in ids:
        key = str(entry_id)
        if key in valid and key not in seen:
            seen.add(key)
            join_model.objects.create(hotel_id=item.hotel_id, item=item, **{f"{fk}_id": entry_id})


def _sync_item_characteristics(item, rows: list) -> None:
    ItemCharacteristic.objects.filter(item=item).hard_delete()
    order = 0
    for row in rows or []:
        name = clean_translations(row.get("name"), field="name")
        value = clean_translations(row.get("value"), field="value")
        if name and value:
            ItemCharacteristic.objects.create(
                hotel_id=item.hotel_id, item=item, name=name, value=value, sort_order=order
            )
            order += 1


def _apply_item_facets(item, data: dict) -> None:
    if data.get("allergen_ids") is not None:
        _sync_join(item, ItemAllergen, "allergen", Allergen, data["allergen_ids"] or [])
    if data.get("marker_ids") is not None:
        _sync_join(item, ItemDietaryMarker, "marker", DietaryMarker, data["marker_ids"] or [])
    if data.get("characteristics") is not None:
        _sync_item_characteristics(item, data["characteristics"] or [])
