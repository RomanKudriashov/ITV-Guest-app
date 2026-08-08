"""
Настройки уровня отеля: главная, поиск, быстрые действия, плитки витрины.

Почему это отель, а не каталог: и переключатели, и координаты, и порог
группировки плиток хранятся в самом отеле (`Hotel.settings`, `Hotel.latitude`,
`ShowcaseTile`). Каталог лишь СОБИРАЕТ витрину по этим настройкам — словари
быстрых действий и построение плиток остаются у него.

Одна калитка на все разделы: `hotel_for_settings()`. Управляющий сервисом сюда
не ходит ни на чтение, ни на запись — это общее всему отелю, а не его сервису.
"""

from __future__ import annotations

from typing import Any

from apps.accounts.roles import require_hotel_admin
from apps.core.context import require_hotel_id
from apps.core.errors import ValidationError

from .models import Hotel, HotelModule, Service, ShowcaseTile
from .module_registry import enabled_module_codes


def hotel_for_settings() -> Hotel:
    require_hotel_admin()
    return Hotel.objects.get(pk=require_hotel_id())


def _room_control_enabled(hotel: Hotel) -> bool:
    return HotelModule.Code.ROOM_CONTROL in enabled_module_codes(hotel)


# --- Быстрые действия стартовой ---------------------------------------------


def quick_actions_payload(hotel: Hotel) -> dict[str, Any]:
    from apps.catalog.services.home import available_quick_actions, selected_codes

    return {"available": available_quick_actions(), "selected": selected_codes(hotel)}


def save_quick_actions(hotel: Hotel, selected: list[str]) -> dict[str, Any]:
    from apps.catalog.services.home import available_quick_actions, validate_codes

    codes = validate_codes(selected)
    settings = dict(hotel.settings or {})
    settings["quick_actions"] = codes
    hotel.settings = settings
    hotel.save(update_fields=["settings", "updated_at"])
    return {"available": available_quick_actions(), "selected": codes}


# --- Главная: погода и строка номера ----------------------------------------


def home_settings_payload(hotel: Hotel) -> dict[str, Any]:
    home = (hotel.settings or {}).get("home") or {}
    return {
        "weather": bool(home.get("weather", False)),
        "room_status": bool(home.get("room_status", True)),
        "latitude": float(hotel.latitude) if hotel.latitude is not None else None,
        "longitude": float(hotel.longitude) if hotel.longitude is not None else None,
        "city": hotel.city or {},
        # Отель без координат раздела погоды не видит: показывать переключатель,
        # который ничего не включает, — обманывать оператора.
        "weather_available": hotel.latitude is not None and hotel.longitude is not None,
        # Строка состояния номера имеет смысл только с модулем управления.
        "room_status_available": _room_control_enabled(hotel),
        # Атрибуция провайдера — условие лицензии, и оператор должен видеть,
        # что именно появится у гостя.
        "weather_provider": {"name": "Open-Meteo", "url": "https://open-meteo.com"},
    }


def save_home_settings(hotel: Hotel, data: Any) -> dict[str, Any]:
    has_point = data.latitude is not None and data.longitude is not None
    if (data.latitude is None) != (data.longitude is None):
        raise ValidationError("Координаты задаются парой: широта и долгота", field="latitude")
    if has_point:
        if not -90 <= data.latitude <= 90:
            raise ValidationError("Широта вне диапазона −90…90", field="latitude")
        if not -180 <= data.longitude <= 180:
            raise ValidationError("Долгота вне диапазона −180…180", field="longitude")

    hotel.latitude = data.latitude
    hotel.longitude = data.longitude
    # Пустые переводы не храним: город, которого нет ни на одном языке, — это
    # не город, а пустая подпись под погодой.
    hotel.city = {code: text for code, text in (data.city or {}).items() if text}
    settings = dict(hotel.settings or {})
    home = dict(settings.get("home") or {})
    # Погоду нельзя включить без координат: включённый флаг без точки — это
    # блок, которого гость никогда не увидит, и вопрос «почему не работает».
    home["weather"] = bool(data.weather) and has_point
    home["room_status"] = bool(data.room_status)
    settings["home"] = home
    hotel.settings = settings
    hotel.save(update_fields=["latitude", "longitude", "city", "settings", "updated_at"])
    return home_settings_payload(hotel)


# --- Поиск -------------------------------------------------------------------


def search_settings_payload(hotel: Hotel) -> dict[str, Any]:
    from apps.catalog.services.search import SearchSettings

    settings = SearchSettings.of(hotel)
    raw = (hotel.settings or {}).get("search") or {}
    return {
        "services": settings.services,
        "items": settings.items,
        "info": settings.info,
        "excluded_services": list(settings.excluded_services),
        "suggestions": raw.get("suggestions") or [],
        # Из чего выбирать: только гостевые заведения — прятать от поиска то,
        # чего гость и так не видит, незачем.
        "available_services": [
            {"code": service.code, "title": service.public_title}
            for service in Service.objects.filter(is_active=True, is_guest_facing=True)
        ],
    }


def save_search_settings(hotel: Hotel, data: Any) -> dict[str, Any]:
    settings = dict(hotel.settings or {})
    settings["search"] = {
        "layers": {
            "services": bool(data.services),
            "items": bool(data.items),
            "info": bool(data.info),
        },
        "excluded_services": [str(code) for code in data.excluded_services],
        # Пустые переводы выбрасываем: подсказка, которой нет ни на одном
        # языке, — это пустая кнопка на экране поиска.
        "suggestions": [entry for entry in data.suggestions if any((entry or {}).values())],
    }
    hotel.settings = settings
    hotel.save(update_fields=["settings", "updated_at"])
    return search_settings_payload(hotel)


# --- Плитки главной-витрины ---------------------------------------------------


def showcase_payload(hotel: Hotel) -> dict[str, Any]:
    from apps.catalog.services.showcase import build_showcase

    return {
        "group_threshold": hotel.showcase_group_threshold,
        "tiles": build_showcase(hotel, moment=hotel.local_now(), include_hidden=True),
    }


def save_showcase(hotel: Hotel, data: Any) -> dict[str, Any]:
    if data.group_threshold is not None:
        hotel.showcase_group_threshold = max(0, data.group_threshold)
        hotel.save(update_fields=["showcase_group_threshold", "updated_at"])

    valid_sizes = {choice.value for choice in ShowcaseTile.Size}
    for tile in data.tiles or []:
        defaults: dict = {}
        if tile.size is not None:
            if tile.size not in valid_sizes:
                raise ValidationError("Недопустимый размер плитки", code="invalid_tile_size")
            defaults["size"] = tile.size
        if tile.sort_order is not None:
            defaults["sort_order"] = max(0, tile.sort_order)
        if tile.is_enabled is not None:
            defaults["is_enabled"] = tile.is_enabled
        if defaults:
            ShowcaseTile.objects.update_or_create(hotel=hotel, key=tile.key, defaults=defaults)

    return showcase_payload(hotel)
