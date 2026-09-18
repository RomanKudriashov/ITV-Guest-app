"""
Баннеры в CMS: раздел «Маркетинг».

ПОЧЕМУ СТАТИСТИКА ЗДЕСЬ, А НЕ В АНАЛИТИКЕ. Аналитика отвечает на два вопроса:
что продано и как работает смена. Баннер не продаёт — связи «баннер → заказ»
мы не измеряем и выдумывать не станем, — а рядом с выручкой его числа читались
бы как канал продаж. Плюс прямое требование: баннер не попадает в аналитику
заказов как продажа. Поэтому показы, клики, переходы и CTR живут на карточке
самого баннера, там же, где правила показа: цифры читают, чтобы поправить
правило, а не чтобы сложить с выручкой.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.errors import PermissionDenied
from apps.hotels.models import HotelModule
from apps.hotels.module_registry import enabled_module_codes
from apps.hotels.services.hotel import current_hotel

from apps.promo.schemas import BannerImageIn, BannerIn, BannerPatch
from apps.promo.services import admin as svc

router = Router(tags=["cms:promo"])


def _gate() -> None:
    """
    Раздел закрыт МОДУЛЕМ маркетинга — как и его сосед по разделу, метки.
    Гейт стоит на СЕРВЕРЕ: спрятать пункт меню в бандле значит не закрыть
    ничего — адрес остаётся рабочим.
    """
    require_hotel_admin()
    if HotelModule.Code.MARKETING not in enabled_module_codes(current_hotel()):
        raise PermissionDenied("Раздел недоступен", code="module_disabled")


@router.get("/banners", summary="Баннеры витрины со статистикой")
def list_banners(request: HttpRequest):
    _gate()
    return {"items": svc.list_banners()}


@router.post("/banners", response={201: dict}, summary="Завести баннер")
def create_banner(request: HttpRequest, payload: BannerIn):
    _gate()
    return 201, svc.banner_payload(svc.create_banner(payload.dict(exclude_unset=True)))


@router.get("/banners/{banner_id}", summary="Баннер")
def get_banner(request: HttpRequest, banner_id: str):
    _gate()
    return svc.banner_payload(svc.get_banner(banner_id))


@router.patch("/banners/{banner_id}", summary="Изменить баннер")
def update_banner(request: HttpRequest, banner_id: str, payload: BannerPatch):
    _gate()
    return svc.banner_payload(svc.update_banner(banner_id, payload.dict(exclude_unset=True)))


@router.delete("/banners/{banner_id}", response={204: None}, summary="Удалить баннер")
def delete_banner(request: HttpRequest, banner_id: str):
    _gate()
    svc.delete_banner(banner_id)
    return 204, None


@router.post("/banners/{banner_id}/images", summary="Добавить кадр карусели")
def add_image(request: HttpRequest, banner_id: str, payload: BannerImageIn):
    _gate()
    return svc.banner_payload(svc.add_image(banner_id, payload.dict()))


@router.delete("/banners/{banner_id}/images/{image_id}", summary="Убрать кадр")
def remove_image(request: HttpRequest, banner_id: str, image_id: str):
    _gate()
    return svc.banner_payload(svc.remove_image(banner_id, image_id))
