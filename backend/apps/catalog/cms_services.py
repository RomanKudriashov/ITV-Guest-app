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
    Category,
    Item,
    ItemImage,
    ModifierGroup,
    ModifierOption,
    OfferingType,
)
from .vocabularies import ALLERGEN_CODES, FLAG_CODES

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
        "title": category.title or {},
        "description": category.description or {},
        "image": serialize_asset(category.image),
        "schedule_id": str(category.schedule_id) if category.schedule_id else None,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
        "items_count": counts.get(category.pk, 0),
    }
    if with_children:
        payload["children"] = []
    return payload


def category_tree() -> list[dict]:
    """Дерево категорий с числом блюд. Один запрос на уровень, без N+1."""
    categories = list(
        Category.objects.filter(type=OfferingType.PRODUCT)
        .select_related("image")
        .order_by("sort_order", "code")
    )
    counts = dict(
        Category.objects.filter(type=OfferingType.PRODUCT)
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
        type=OfferingType.PRODUCT,
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

    return category_tree()


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
        "flags": list(item.flags or []),
        "allergens": list(item.allergens or []),
        "schedule_id": str(item.schedule_id) if item.schedule_id else None,
        "sort_order": item.sort_order,
        "is_active": item.is_active,
        "in_stock": item.in_stock,
    }
    if with_modifiers:
        payload["modifier_groups"] = [
            serialize_modifier_group(group) for group in item.modifier_groups.all()
        ]
    return payload


def _item_queryset():
    return (
        Item.objects.filter(type=OfferingType.PRODUCT)
        .select_related("category")
        .prefetch_related("images__asset")
    )


def list_items(*, category_id=None, search: str = "") -> list[dict]:
    queryset = _item_queryset()
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
        queryset = queryset.prefetch_related("modifier_groups__options")
    item = queryset.filter(pk=item_id).first()
    if item is None:
        raise NotFoundError("Блюдо не найдено")
    return item


def _validate_price(price: Any) -> int:
    if price is None:
        return 0
    try:
        value = int(price)
    except (TypeError, ValueError):
        raise ValidationError("Цена должна быть целым числом копеек", field="price") from None
    if value < 0:
        raise ValidationError("Цена не может быть отрицательной", field="price")
    return value


def _validate_codes(values: Any, allowed: set[str], *, field: str) -> list[str]:
    if not values:
        return []
    codes = [str(code) for code in values]
    unknown = sorted(set(codes) - allowed)
    if unknown:
        raise ValidationError(
            f"Неизвестные значения: {', '.join(unknown)}", field=field, code="unknown_code"
        )
    # Порядок сохраняем, дубликаты убираем.
    return list(dict.fromkeys(codes))


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

    item = Item.objects.create(
        type=OfferingType.PRODUCT,
        category=category,
        code=data.get("code") or make_code(Item, title, prefix="item"),
        title=title,
        description=clean_translations(data.get("description"), field="description"),
        price=_validate_price(data.get("price")),
        flags=_validate_codes(data.get("flags"), FLAG_CODES, field="flags"),
        allergens=_validate_codes(data.get("allergens"), ALLERGEN_CODES, field="allergens"),
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order")
        if data.get("sort_order") is not None
        else _next_sort_order(Item.objects.filter(category=category)),
        is_active=data.get("is_active", True),
        in_stock=data.get("in_stock", True),
    )
    if data.get("image_ids"):
        set_item_images(item.pk, data["image_ids"])
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
    if "category_id" in data:
        item.category = _resolve_category(data["category_id"])
    if "price" in data:
        item.price = _validate_price(data["price"])
    if "flags" in data:
        item.flags = _validate_codes(data["flags"], FLAG_CODES, field="flags")
    if "allergens" in data:
        item.allergens = _validate_codes(data["allergens"], ALLERGEN_CODES, field="allergens")
    if "schedule_id" in data:
        item.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data and data["sort_order"] is not None:
        item.sort_order = data["sort_order"]
    if "is_active" in data:
        item.is_active = data["is_active"]
    if "in_stock" in data:
        item.in_stock = data["in_stock"]
    if data.get("code"):
        item.code = data["code"]

    item.save()
    if "image_ids" in data:
        set_item_images(item.pk, data["image_ids"] or [])
    return item


@transaction.atomic
def delete_item(item_id) -> None:
    item = get_item(item_id)
    # Позиции заказов ссылаются на Item через PROTECT, поэтому удаление именно
    # мягкое: история заказов обязана пережить удаление блюда из меню.
    ItemImage.objects.filter(item=item).delete()
    ModifierOption.objects.filter(group__item=item).delete()
    ModifierGroup.objects.filter(item=item).delete()
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
