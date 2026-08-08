"""CMS: настройки поиска — слои, исключения, подсказки."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import SearchSettingsIn
from apps.hotels import hotel_settings as svc

router = Router(tags=["cms:catalog"])


@router.get("/search-settings", summary="Настройки поиска: слои, исключения, подсказки")
def cms_get_search_settings(request: HttpRequest):
    return svc.search_settings_payload(svc.hotel_for_settings())


@router.put("/search-settings", summary="Сохранить настройки поиска")
def cms_put_search_settings(request: HttpRequest, payload: SearchSettingsIn):
    return svc.save_search_settings(svc.hotel_for_settings(), payload)
