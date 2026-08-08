"""CMS: группы модификаторов позиции и их варианты."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import (
    ModifierGroupIn,
    ModifierGroupOut,
    ModifierGroupPatch,
    ModifierOptionIn,
    ModifierOptionOut,
    ModifierOptionPatch,
)
from apps.catalog.services import cms as svc
from apps.core.schemas import OkOut, ReorderIn

router = Router(tags=["cms:catalog"])


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
