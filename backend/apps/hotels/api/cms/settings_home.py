"""CMS: настройки главной — быстрые действия, погода, строка номера."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.hotels.services import hotel_settings as svc
from apps.hotels.schemas.cms import HomeSettingsIn
from apps.catalog.schemas.cms import QuickActionsIn

router = Router(tags=["cms:catalog"])


@router.get("/quick-actions", summary="Быстрые действия стартовой (словарь + выбор)")
def cms_get_quick_actions(request: HttpRequest):
    return svc.quick_actions_payload(svc.hotel_for_settings())


@router.put("/quick-actions", summary="Сохранить набор быстрых действий")
def cms_put_quick_actions(request: HttpRequest, payload: QuickActionsIn):
    return svc.save_quick_actions(svc.hotel_for_settings(), payload.selected)


@router.get("/weather/cities", summary="Подсказка городов: набрал «Сочи» — выбрал из списка")
def cms_search_cities(request: HttpRequest, q: str = "", lang: str | None = None):
    """
    Координаты оператор не вводит и не видит: он знает город. Справочник —
    у того же провайдера, что и погода (лицензия общая, docs/ops/weather.md).
    """
    from apps.core.context import current_language
    from apps.integrations.weather import service as weather

    hotel = svc.hotel_for_settings()
    cities = weather.search_cities(q, lang or current_language() or hotel.default_language)
    if cities is None:
        # «Справочник молчит» и «ничего не найдено» — разные ответы, и экран
        # обязан их различать: во втором случае искать дальше бессмысленно.
        return {"cities": [], "available": False}
    return {"cities": cities, "available": True}


@router.get("/weather/preview", summary="Сейчас в выбранном городе — чтобы ошибка была видна сразу")
def cms_weather_preview(request: HttpRequest, latitude: float, longitude: float):
    """
    Показ рядом с выбором города: оператор видит «+18, ясно» ДО сохранения и
    замечает промах (не тот «Сочи») немедленно, а не через жалобу гостя.
    """
    from apps.integrations.weather import service as weather

    hotel = svc.hotel_for_settings()
    observation = weather.get_provider().current(latitude, longitude)
    if observation is None:
        return {"available": False}
    units = hotel.temperature_units or "c"
    celsius = observation.temperature_c
    return {
        "available": True,
        "units": units,
        "temperature": round(celsius * 9 / 5 + 32) if units == "f" else round(celsius),
        "code": observation.code,
        "is_day": observation.is_day,
    }


@router.get("/home-settings", summary="Настройки главной: погода, координаты, строка номера")
def cms_get_home_settings(request: HttpRequest):
    return svc.home_settings_payload(svc.hotel_for_settings())


@router.put("/home-settings", summary="Сохранить настройки главной")
def cms_put_home_settings(request: HttpRequest, payload: HomeSettingsIn):
    return svc.save_home_settings(svc.hotel_for_settings(), payload)
