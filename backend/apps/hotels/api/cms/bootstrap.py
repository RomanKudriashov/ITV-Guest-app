"""CMS: стартовый снимок, реестр модулей и навигация раздела."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.schemas.cms import BootstrapOut
from apps.hotels.services.bootstrap import bootstrap_payload
from apps.hotels.services.hotel import current_hotel

router = Router(tags=["cms"])


@router.get("/bootstrap", response=BootstrapOut, summary="Всё для старта CMS")
def bootstrap(request: HttpRequest):
    return bootstrap_payload()


# --- Реестр модулей (только чтение) ----------------------------------------


@router.get("/modules", summary="Включённые модули отеля (для гейтинга навигации)")
def hotel_modules(request: HttpRequest):
    """Отель читает свой реестр модулей — основа гейтинга навигации CMS (R4)."""
    from apps.hotels.module_registry import list_modules

    hotel = current_hotel()
    return {"tariff": hotel.tariff, "modules": list_modules(hotel)}


# --- Навигация -------------------------------------------------------------


@router.get("/navigation", summary="Разделы CMS этого отеля и этой роли")
def cms_navigation(request: HttpRequest):
    """
    Навигация приходит с сервера, а не собирается на клиенте: гейтинг решает
    реестр модулей, и собери меню во фронте — список того, за что отель не
    платил, всё равно уехал бы к нему в бандл.
    """
    from apps.accounts.services.roles import current_access
    from apps.hotels.services.cms_navigation import build_navigation

    return {"groups": build_navigation(current_hotel(), access=current_access())}
