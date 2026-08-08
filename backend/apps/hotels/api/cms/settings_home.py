"""CMS: настройки главной — быстрые действия, погода, строка номера."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.hotels import hotel_settings as svc
from apps.hotels.schemas.cms import HomeSettingsIn
from apps.catalog.schemas.cms import QuickActionsIn

router = Router(tags=["cms:catalog"])


@router.get("/quick-actions", summary="Быстрые действия стартовой (словарь + выбор)")
def cms_get_quick_actions(request: HttpRequest):
    return svc.quick_actions_payload(svc.hotel_for_settings())


@router.put("/quick-actions", summary="Сохранить набор быстрых действий")
def cms_put_quick_actions(request: HttpRequest, payload: QuickActionsIn):
    return svc.save_quick_actions(svc.hotel_for_settings(), payload.selected)


@router.get("/home-settings", summary="Настройки главной: погода, координаты, строка номера")
def cms_get_home_settings(request: HttpRequest):
    return svc.home_settings_payload(svc.hotel_for_settings())


@router.put("/home-settings", summary="Сохранить настройки главной")
def cms_put_home_settings(request: HttpRequest, payload: HomeSettingsIn):
    return svc.save_home_settings(svc.hotel_for_settings(), payload)
