"""
CMS: справочники каталога — бейджи, аллергены, диетические маркеры.

Три справочника в одном файле, потому что это один ресурс по сути: словарь
отеля, из которого потом выбирают на карточке позиции. Резать их на три файла
по двадцать строк значило бы называть файлами то, что читается одним экраном.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import BadgeIn, BadgePatch, DictEntryIn, DictEntryPatch
from apps.catalog.services import cms as svc
from apps.core.schemas import OkOut

router = Router(tags=["cms:catalog"])


# --- Маркетинговые бейджи ---------------------------------------------------


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


# --- Справочники аллергенов и диетических маркеров ---------------------------


@router.get("/allergens", summary="Справочник аллергенов отеля")
def cms_list_allergens(request: HttpRequest):
    return svc.list_allergens()


@router.post("/allergens", response={201: dict}, summary="Добавить свой аллерген")
def cms_create_allergen(request: HttpRequest, payload: DictEntryIn):
    return 201, svc._serialize_dict_entry(svc.create_allergen(payload.dict()))


@router.patch("/allergens/{entry_id}", summary="Изменить аллерген (вкл/выкл, порядок)")
def cms_update_allergen(request: HttpRequest, entry_id: str, payload: DictEntryPatch):
    return svc._serialize_dict_entry(svc.update_allergen(entry_id, payload.dict(exclude_unset=True)))


@router.delete("/allergens/{entry_id}", response=OkOut, summary="Удалить свой аллерген (системный нельзя)")
def cms_delete_allergen(request: HttpRequest, entry_id: str):
    svc.delete_allergen(entry_id)
    return {"ok": True}


@router.get("/markers", summary="Справочник диетических маркеров отеля")
def cms_list_markers(request: HttpRequest):
    return svc.list_markers()


@router.post("/markers", response={201: dict}, summary="Добавить свой маркер")
def cms_create_marker(request: HttpRequest, payload: DictEntryIn):
    return 201, svc._serialize_dict_entry(svc.create_marker(payload.dict()))


@router.patch("/markers/{entry_id}", summary="Изменить маркер (вкл/выкл, порядок)")
def cms_update_marker(request: HttpRequest, entry_id: str, payload: DictEntryPatch):
    return svc._serialize_dict_entry(svc.update_marker(entry_id, payload.dict(exclude_unset=True)))


@router.delete("/markers/{entry_id}", response=OkOut, summary="Удалить свой маркер (системный нельзя)")
def cms_delete_marker(request: HttpRequest, entry_id: str):
    svc.delete_marker(entry_id)
    return {"ok": True}
