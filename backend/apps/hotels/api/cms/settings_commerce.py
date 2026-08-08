"""CMS: настройки коммерции отеля."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.hotels.services import hotel_settings as svc
from apps.hotels.services.commerce_settings import serialize_commerce_settings, update_commerce_settings
from apps.hotels.schemas.cms import CommerceSettingsIn

router = Router(tags=["cms:catalog"])


@router.get("/commerce-settings", summary="Настройки коммерции отеля")
def cms_get_commerce_settings(request: HttpRequest):
    return serialize_commerce_settings(svc.hotel_for_settings())


@router.patch("/commerce-settings", summary="Изменить настройки коммерции")
def cms_patch_commerce_settings(request: HttpRequest, payload: CommerceSettingsIn):
    return update_commerce_settings(svc.hotel_for_settings(), payload.dict(exclude_unset=True))
