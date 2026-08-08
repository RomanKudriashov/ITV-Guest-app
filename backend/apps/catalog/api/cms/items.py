"""
CMS: позиции каталога и всё, что принадлежит самой позиции.

Поля заявки, конфигурация брони и набор бейджей живут здесь, а не отдельными
файлами: это не самостоятельные ресурсы, а части одной карточки — редактор
открывает их одним экраном и правит вместе с позицией.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import (
    ItemBadgesIn,
    ItemDetailOut,
    ItemImagesIn,
    ItemIn,
    ItemOut,
    ItemPatch,
    RequestFieldIn,
    RequestFieldOut,
    RequestFieldPatch,
    SlotConfigIn,
    StockIn,
)
from apps.catalog.services import cms as svc
from apps.core.schemas import ItemsReorderIn, OkOut, ReorderIn, ToggleIn

router = Router(tags=["cms:catalog"])


@router.get("/items", response=list[ItemOut], summary="Список блюд")
def list_items(
    request: HttpRequest,
    category_id: str | None = None,
    search: str = "",
    type: str | None = None,
    service_id: str | None = None,
):
    return svc.list_items(
        category_id=category_id, search=search, offering_type=type, service_id=service_id
    )


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


# --- Бейджи позиции ---------------------------------------------------------


@router.put("/items/{item_id}/badges", summary="Назначить бейджи позиции (заменяет набор)")
def cms_assign_item_badges(request: HttpRequest, item_id: str, payload: ItemBadgesIn):
    return {"badges": svc.assign_item_badges(item_id, payload.badge_ids)}
