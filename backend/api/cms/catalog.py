"""
CMS: категории, блюда, модификаторы.

Вьюхи намеренно тонкие — разобрать запрос, позвать сервис, отдать результат.
Вся логика и валидация в apps/catalog/cms_services.py; доменные ошибки
превращает в HTTP общий обработчик (api/__init__.py).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog import cms_services as svc

from .schemas import (
    CategoryIn,
    CategoryPatch,
    CategoryTreeOut,
    ItemDetailOut,
    ItemImagesIn,
    ItemIn,
    ItemOut,
    ItemPatch,
    ItemsReorderIn,
    ModifierGroupIn,
    ModifierGroupOut,
    ModifierGroupPatch,
    ModifierOptionIn,
    ModifierOptionOut,
    ModifierOptionPatch,
    OkOut,
    ReorderIn,
    RequestFieldIn,
    SlotConfigIn,
    RequestFieldOut,
    RequestFieldPatch,
    StockIn,
    ToggleIn,
)

router = Router(tags=["cms:catalog"])


# --- Категории -------------------------------------------------------------


@router.get("/categories", response=list[CategoryTreeOut], summary="Дерево категорий")
def list_categories(request: HttpRequest, type: str = "product"):
    return svc.category_tree(type)


@router.post("/categories", response={201: CategoryTreeOut}, summary="Создать категорию")
def create_category(request: HttpRequest, payload: CategoryIn):
    category = svc.create_category(payload.dict(exclude_unset=True))
    return 201, svc.serialize_category(category, with_children=True)


# ВНИМАНИЕ: статические пути (`/reorder`) обязаны объявляться РАНЬШЕ
# параметризованных (`/{id}`) — Django резолвит URL по порядку регистрации, и
# `/categories/{category_id}` иначе перехватит слово "reorder" и вернёт 405.
@router.post(
    "/categories/reorder", response=list[CategoryTreeOut], summary="Сортировка категорий"
)
def reorder_categories(request: HttpRequest, payload: ReorderIn):
    return svc.reorder_categories([entry.dict() for entry in payload.items])


@router.get("/categories/{category_id}", response=CategoryTreeOut, summary="Категория")
def get_category(request: HttpRequest, category_id: str):
    return svc.serialize_category(svc.get_category(category_id), with_children=True)


@router.patch("/categories/{category_id}", response=CategoryTreeOut, summary="Изменить категорию")
def update_category(request: HttpRequest, category_id: str, payload: CategoryPatch):
    category = svc.update_category(category_id, payload.dict(exclude_unset=True))
    return svc.serialize_category(category, with_children=True)


@router.delete("/categories/{category_id}", response=OkOut, summary="Удалить категорию")
def delete_category(request: HttpRequest, category_id: str, cascade: bool = False):
    svc.delete_category(category_id, cascade=cascade)
    return {"ok": True}


@router.post(
    "/categories/{category_id}/toggle", response=CategoryTreeOut, summary="Вкл/выкл категорию"
)
def toggle_category(request: HttpRequest, category_id: str, payload: ToggleIn):
    category = svc.toggle_category(category_id, is_active=payload.is_active)
    return svc.serialize_category(category, with_children=True)


# --- Блюда -----------------------------------------------------------------


@router.get("/items", response=list[ItemOut], summary="Список блюд")
def list_items(
    request: HttpRequest,
    category_id: str | None = None,
    search: str = "",
    type: str | None = None,
):
    return svc.list_items(category_id=category_id, search=search, offering_type=type)


@router.post("/items", response={201: ItemDetailOut}, summary="Создать блюдо")
def create_item(request: HttpRequest, payload: ItemIn):
    item = svc.create_item(payload.dict(exclude_unset=True))
    return 201, svc.serialize_item(svc.get_item(item.pk, with_modifiers=True), with_modifiers=True)


@router.post("/items/reorder", response=list[ItemOut], summary="Сортировка блюд")
def reorder_items(request: HttpRequest, payload: ItemsReorderIn):
    return svc.reorder_items(
        category_id=payload.category_id, entries=[entry.dict() for entry in payload.items]
    )


@router.get("/items/{item_id}", response=ItemDetailOut, summary="Блюдо с модификаторами")
def get_item(request: HttpRequest, item_id: str):
    return svc.serialize_item(svc.get_item(item_id, with_modifiers=True), with_modifiers=True)


@router.patch("/items/{item_id}", response=ItemDetailOut, summary="Изменить блюдо")
def update_item(request: HttpRequest, item_id: str, payload: ItemPatch):
    svc.update_item(item_id, payload.dict(exclude_unset=True))
    return svc.serialize_item(svc.get_item(item_id, with_modifiers=True), with_modifiers=True)


@router.delete("/items/{item_id}", response=OkOut, summary="Удалить блюдо")
def delete_item(request: HttpRequest, item_id: str):
    svc.delete_item(item_id)
    return {"ok": True}


@router.post("/items/{item_id}/stock", response=ItemOut, summary="Стоп-лист")
def set_item_stock(request: HttpRequest, item_id: str, payload: StockIn):
    return svc.serialize_item(svc.set_item_stock(item_id, in_stock=payload.in_stock))


@router.post("/items/{item_id}/toggle", response=ItemOut, summary="Вкл/выкл блюдо")
def toggle_item(request: HttpRequest, item_id: str, payload: ToggleIn):
    return svc.serialize_item(svc.toggle_item(item_id, is_active=payload.is_active))


@router.put("/items/{item_id}/images", response=ItemDetailOut, summary="Набор и порядок фото")
def set_item_images(request: HttpRequest, item_id: str, payload: ItemImagesIn):
    svc.set_item_images(item_id, payload.image_ids)
    return svc.serialize_item(svc.get_item(item_id, with_modifiers=True), with_modifiers=True)


# --- Группы модификаторов --------------------------------------------------


@router.post(
    "/items/{item_id}/modifier-groups",
    response={201: ModifierGroupOut},
    summary="Создать группу модификаторов",
)
def create_modifier_group(request: HttpRequest, item_id: str, payload: ModifierGroupIn):
    group = svc.create_modifier_group(item_id, payload.dict(exclude_unset=True))
    return 201, svc.serialize_modifier_group(group)


@router.patch(
    "/modifier-groups/{group_id}", response=ModifierGroupOut, summary="Изменить группу"
)
def update_modifier_group(request: HttpRequest, group_id: str, payload: ModifierGroupPatch):
    group = svc.update_modifier_group(group_id, payload.dict(exclude_unset=True))
    return svc.serialize_modifier_group(group)


@router.delete("/modifier-groups/{group_id}", response=OkOut, summary="Удалить группу")
def delete_modifier_group(request: HttpRequest, group_id: str):
    svc.delete_modifier_group(group_id)
    return {"ok": True}


@router.post(
    "/items/{item_id}/modifier-groups/reorder",
    response=list[ModifierGroupOut],
    summary="Сортировка групп",
)
def reorder_modifier_groups(request: HttpRequest, item_id: str, payload: ReorderIn):
    return svc.reorder_modifier_groups(item_id, [entry.dict() for entry in payload.items])


# --- Опции -----------------------------------------------------------------


@router.post(
    "/modifier-groups/{group_id}/options",
    response={201: ModifierOptionOut},
    summary="Создать вариант",
)
def create_modifier_option(request: HttpRequest, group_id: str, payload: ModifierOptionIn):
    option = svc.create_modifier_option(group_id, payload.dict(exclude_unset=True))
    return 201, svc.serialize_modifier_option(option)


@router.patch(
    "/modifier-options/{option_id}", response=ModifierOptionOut, summary="Изменить вариант"
)
def update_modifier_option(request: HttpRequest, option_id: str, payload: ModifierOptionPatch):
    option = svc.update_modifier_option(option_id, payload.dict(exclude_unset=True))
    return svc.serialize_modifier_option(option)


@router.delete("/modifier-options/{option_id}", response=OkOut, summary="Удалить вариант")
def delete_modifier_option(request: HttpRequest, option_id: str):
    svc.delete_modifier_option(option_id)
    return {"ok": True}


@router.post(
    "/modifier-groups/{group_id}/options/reorder",
    response=list[ModifierOptionOut],
    summary="Сортировка вариантов",
)
def reorder_modifier_options(request: HttpRequest, group_id: str, payload: ReorderIn):
    return svc.reorder_modifier_options(group_id, [entry.dict() for entry in payload.items])


# --- Поля заявки-услуги ----------------------------------------------------
# Ровно та же форма CRUD, что у модификаторов: одинаковые вещи должны и
# выглядеть одинаково, иначе редактор придётся писать дважды.


@router.post(
    "/items/{item_id}/request-fields",
    response={201: RequestFieldOut},
    summary="Создать поле заявки",
)
def create_request_field(request: HttpRequest, item_id: str, payload: RequestFieldIn):
    entry = svc.create_request_field(item_id, payload.dict(exclude_unset=True))
    return 201, svc.serialize_request_field(entry)


@router.patch(
    "/request-fields/{field_id}", response=RequestFieldOut, summary="Изменить поле заявки"
)
def update_request_field(request: HttpRequest, field_id: str, payload: RequestFieldPatch):
    entry = svc.update_request_field(field_id, payload.dict(exclude_unset=True))
    return svc.serialize_request_field(entry)


@router.delete("/request-fields/{field_id}", response=OkOut, summary="Удалить поле заявки")
def delete_request_field(request: HttpRequest, field_id: str):
    svc.delete_request_field(field_id)
    return {"ok": True}


@router.post(
    "/items/{item_id}/request-fields/reorder",
    response=list[RequestFieldOut],
    summary="Сортировка полей заявки",
)
def reorder_request_fields(request: HttpRequest, item_id: str, payload: ReorderIn):
    return svc.reorder_request_fields(item_id, [entry.dict() for entry in payload.items])


# --- Конфигурация брони (тип slot) -----------------------------------------


@router.get("/items/{item_id}/slot-config", summary="Конфигурация брони")
def get_slot_config(request: HttpRequest, item_id: str):
    return svc.get_slot_config(item_id) or {}


@router.put("/items/{item_id}/slot-config", summary="Сохранить конфигурацию брони")
def put_slot_config(request: HttpRequest, item_id: str, payload: SlotConfigIn):
    return svc.upsert_slot_config(item_id, payload.dict())


# --- Маркетинговые бейджи ---------------------------------------------------

from ninja import Schema  # noqa: E402


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


@router.get("/badges", summary="Маркетинговые бейджи отеля")
def cms_list_badges(request: HttpRequest):
    return svc.list_badges()


@router.post("/badges", response={201: dict}, summary="Создать бейдж")
def cms_create_badge(request: HttpRequest, payload: BadgeIn):
    return 201, svc.serialize_badge(svc.create_badge(payload.dict()))


@router.patch("/badges/{badge_id}", summary="Изменить бейдж")
def cms_update_badge(request: HttpRequest, badge_id: str, payload: BadgePatch):
    return svc.serialize_badge(svc.update_badge(badge_id, payload.dict(exclude_unset=True)))


@router.delete("/badges/{badge_id}", response=OkOut, summary="Удалить бейдж")
def cms_delete_badge(request: HttpRequest, badge_id: str):
    svc.delete_badge(badge_id)
    return {"ok": True}


@router.put("/items/{item_id}/badges", summary="Назначить бейджи позиции (заменяет набор)")
def cms_assign_item_badges(request: HttpRequest, item_id: str, payload: ItemBadgesIn):
    return {"badges": svc.assign_item_badges(item_id, payload.badge_ids)}


# --- Быстрые действия стартовой ---------------------------------------------


class QuickActionsIn(Schema):
    selected: list[str] = []


def _hotel_for_settings():
    from apps.core.context import require_hotel_id
    from apps.hotels.models import Hotel

    return Hotel.objects.get(pk=require_hotel_id())


@router.get("/quick-actions", summary="Быстрые действия стартовой (словарь + выбор)")
def cms_get_quick_actions(request: HttpRequest):
    from apps.catalog.home import available_quick_actions, selected_codes

    hotel = _hotel_for_settings()
    return {"available": available_quick_actions(), "selected": selected_codes(hotel)}


@router.put("/quick-actions", summary="Сохранить набор быстрых действий")
def cms_put_quick_actions(request: HttpRequest, payload: QuickActionsIn):
    from apps.catalog.home import available_quick_actions, validate_codes

    hotel = _hotel_for_settings()
    codes = validate_codes(payload.selected)
    settings = dict(hotel.settings or {})
    settings["quick_actions"] = codes
    hotel.settings = settings
    hotel.save(update_fields=["settings", "updated_at"])
    return {"available": available_quick_actions(), "selected": codes}


# --- Настройки коммерции -----------------------------------------------------


class CommerceSettingsIn(Schema):
    """Все поля необязательны — PATCH меняет только присланное."""

    service_fee_bp: int | None = None
    tax_bp: int | None = None
    tax_inclusive: bool | None = None
    tip_presets: list[int] | None = None
    free_delivery_threshold_minor: int | None = None
    price_round_to_minor: int | None = None


@router.get("/commerce-settings", summary="Настройки коммерции отеля")
def cms_get_commerce_settings(request: HttpRequest):
    from apps.hotels.commerce_settings import serialize_commerce_settings

    return serialize_commerce_settings(_hotel_for_settings())


@router.patch("/commerce-settings", summary="Изменить настройки коммерции")
def cms_patch_commerce_settings(request: HttpRequest, payload: CommerceSettingsIn):
    from apps.hotels.commerce_settings import update_commerce_settings

    return update_commerce_settings(_hotel_for_settings(), payload.dict(exclude_unset=True))
