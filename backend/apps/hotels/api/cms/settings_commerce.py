"""CMS: настройки коммерции отеля и то, где заведения от них отступают."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.hotels.services import hotel_settings as svc
from apps.hotels.services.commerce_settings import serialize_commerce_settings, update_commerce_settings
from apps.hotels.schemas.cms import CommerceInheritanceResetIn, CommerceSettingsIn

router = Router(tags=["cms:catalog"])


@router.get("/commerce-settings", summary="Настройки коммерции отеля")
def cms_get_commerce_settings(request: HttpRequest):
    return serialize_commerce_settings(svc.hotel_for_settings())


@router.patch("/commerce-settings", summary="Изменить настройки коммерции")
def cms_patch_commerce_settings(request: HttpRequest, payload: CommerceSettingsIn):
    return update_commerce_settings(svc.hotel_for_settings(), payload.dict(exclude_unset=True))


@router.get("/commerce-settings/overrides", summary="У кого из заведений своя коммерция")
def cms_commerce_overrides(request: HttpRequest):
    """
    Ответ на вопрос «почему сбор не везде одинаковый» — СПИСКОМ.

    До этой ручки он собирался обходом карточек по одной, и собирался неверно:
    заглянув в шесть заведений из девяти, человек уходил с уверенностью, что
    везде одинаково. Это деньги, и ошибка здесь приходит счётом гостя.
    """
    from apps.hotels.services import commerce_inheritance

    return commerce_inheritance.report(svc.hotel_for_settings())


@router.post("/commerce-settings/overrides/reset", summary="Вернуть заведения к настройкам отеля")
def cms_commerce_overrides_reset(request: HttpRequest, payload: CommerceInheritanceResetIn):
    """
    ЯВНОЕ действие. Правка отеля не перетирает своё значение заведения никогда
    — ни при изменении коммерции отеля, ни потом; убрать его можно только
    отсюда, назвав заведения.
    """
    from apps.hotels.services import commerce_inheritance

    changed = commerce_inheritance.reset(
        svc.hotel_for_settings(), payload.service_ids, fields=payload.fields or None
    )
    return {"changed": changed}
