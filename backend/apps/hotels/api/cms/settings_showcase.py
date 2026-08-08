"""CMS: плитки главной-витрины — порядок, размер, показ."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import ShowcaseSettingsIn
from apps.hotels import hotel_settings as svc

router = Router(tags=["cms:catalog"])


@router.get("/showcase", summary="Плитки главной-витрины (порядок, размер, показ)")
def cms_get_showcase(request: HttpRequest):
    return svc.showcase_payload(svc.hotel_for_settings())


@router.put("/showcase", summary="Сохранить настройки плиток главной")
def cms_put_showcase(request: HttpRequest, payload: ShowcaseSettingsIn):
    return svc.save_showcase(svc.hotel_for_settings(), payload)
