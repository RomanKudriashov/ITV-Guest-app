"""
Справочники для форм NaviRoom Control (партия 54): пояса, валюты, языки,
правило поддомена, города флота — и проверка поддомена на ходу.

Адреса — под `/reference/`, а не под `/hotels/`: там `/hotels/{hotel_id}`
поймал бы «subdomain-check» как идентификатор отеля.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires
from apps.hotels.services import hotel_fields

router = PlatformRouter(tags=["platform"])


@router.get("/reference/hotel-fields", summary="Списки для формы отеля: пояса, валюты, языки, поддомен")
@requires(READ)
def hotel_field_reference(request: HttpRequest):
    return hotel_fields.reference()


@router.get("/reference/subdomain-check", summary="Свободен ли поддомен: формат, запрет, занятость")
@requires(READ)
def subdomain_check(request: HttpRequest, value: str = ""):
    return hotel_fields.subdomain_status(value)


@router.get("/reference/cities", summary="Города отелей флота — для правила группы")
@requires(READ)
def hotel_city_list(request: HttpRequest):
    return {"cities": hotel_fields.hotel_cities()}
