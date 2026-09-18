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

import zoneinfo

from typing import Any

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import require_hotel_id
from apps.core.errors import ValidationError

from apps.hotels.models import Hotel, HotelModule, Service, ShowcaseTile
from apps.hotels.module_registry import enabled_module_codes


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


def _as_map(value: Any, language: str | None) -> dict[str, str]:
    if isinstance(value, dict):
        return {code: text for code, text in value.items() if text}
    if isinstance(value, str) and value.strip():
        return {(language or "en"): value.strip()}
    return {}


def _city_choice(hotel: Hotel, data: Any) -> dict[str, Any] | None:
    """
    Выбранный в подсказке город → координаты, названия на языках отеля и пояс.

    ОТЕЛЬ КООРДИНАТ НЕ ВВОДИТ. Их знает справочник, а оператор знает город;
    ручной ввод пары чисел заполнен на стенде у одного отеля из двадцати
    девяти — то есть погоду включить физически не мог никто.
    """
    from apps.integrations.weather import service as weather

    if data.city_id is None:
        return None
    default = hotel.default_language or "en"
    found = weather.city_by_id(data.city_id, default)
    if found is None:
        raise ValidationError(
            "Справочник городов не отвечает или города нет — попробуйте позже",
            field="city_id",
            code="city_not_found",
        )

    languages = _hotel_languages(hotel)
    names = weather.city_in_languages(found["id"], languages)
    names.setdefault(default, found["name"])
    return {
        "latitude": found["latitude"],
        "longitude": found["longitude"],
        "timezone": found.get("timezone") or "",
        "city": {code: text for code, text in names.items() if text},
    }


def _hotel_languages(hotel: Hotel) -> list[str]:
    from apps.hotels.models import HotelLanguage

    codes = list(
        HotelLanguage.objects.filter(hotel=hotel, is_active=True)
        .order_by("sort_order")
        .values_list("code", flat=True)
    )
    return codes or [hotel.default_language or "en"]


def home_settings_payload(hotel: Hotel) -> dict[str, Any]:
    home = (hotel.settings or {}).get("home") or {}
    return {
        "weather": bool(home.get("weather", False)),
        "room_status": bool(home.get("room_status", True)),
        "latitude": float(hotel.latitude) if hotel.latitude is not None else None,
        "longitude": float(hotel.longitude) if hotel.longitude is not None else None,
        # СЛОВАРЁМ ВСЕГДА. Строка в переводимом поле (след ранних переносов)
        # уезжала в форму и возвращалась строкой — сервер отвечал 422, и
        # настройки главной не сохранялись вовсе. Миграция 0039 чинит данные,
        # это — защита на случай, если строка появится снова.
        "city": _as_map(hotel.city, hotel.default_language),
        "name": _as_map(hotel.name, hotel.default_language),
        # Часовой пояс — рядом с городом и часами, которые от него и считаются.
        "timezone": hotel.timezone,
        # Список зон отдаётся сервером, а не зашивается в витрину: набор зон
        # меняется решениями правительств, и правится он обновлением tzdata, а
        # не пересборкой фронта.
        "timezone_options": sorted(zoneinfo.available_timezones()),
        # Отель без координат раздела погоды не видит: показывать переключатель,
        # который ничего не включает, — обманывать оператора.
        "weather_available": hotel.latitude is not None and hotel.longitude is not None,
        # Строка состояния номера имеет смысл только с модулем управления.
        "room_status_available": _room_control_enabled(hotel),
        # Атрибуция провайдера — условие лицензии, и оператор должен видеть,
        # что именно появится у гостя.
        "weather_provider": {"name": "Open-Meteo", "url": "https://open-meteo.com"},
        # Единицы — решение отеля: «24°» без буквы читается по-разному.
        "temperature_units": hotel.temperature_units,
    }


def save_home_settings(hotel: Hotel, data: Any) -> dict[str, Any]:
    chosen = _city_choice(hotel, data)
    # КООРДИНАТЫ МЕНЯЕТ ТОЛЬКО ВЫБОР ГОРОДА. Пустые широта и долгота в запросе
    # значат «не трогали»: форма их больше не показывает, и сохранение
    # соседней настройки не должно молча стирать точку вместе с погодой.
    latitude = chosen["latitude"] if chosen else (
        data.latitude if data.latitude is not None else hotel.latitude
    )
    longitude = chosen["longitude"] if chosen else (
        data.longitude if data.longitude is not None else hotel.longitude
    )
    has_point = latitude is not None and longitude is not None
    if chosen is None and (data.latitude is None) != (data.longitude is None):
        raise ValidationError("Координаты задаются парой: широта и долгота", field="latitude")
    if has_point:
        if not -90 <= latitude <= 90:
            raise ValidationError("Широта вне диапазона −90…90", field="latitude")
        if not -180 <= longitude <= 180:
            raise ValidationError("Долгота вне диапазона −180…180", field="longitude")

    # Пояс проверяется ПРИ ЗАПИСИ. Неизвестное имя молча превращается в UTC
    # (так устроен `Hotel.tzinfo`), и отель во Владивостоке начинает показывать
    # лондонское время, ничем не выдавая опечатки. Ловим здесь.
    if data.timezone is not None:
        name = data.timezone.strip()
        if not name:
            raise ValidationError("Часовой пояс не может быть пустым", field="timezone")
        try:
            zoneinfo.ZoneInfo(name)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise ValidationError(
                f"Неизвестный часовой пояс: {name}. Ожидается имя зоны, например Asia/Vladivostok",
                field="timezone",
            ) from None
        hotel.timezone = name

    if data.name is not None:
        # Хотя бы один язык обязателен: отель без названия на витрине
        # превращается в пустую шапку, и заметит это гость, а не оператор.
        cleaned = {
            code: str(text).strip()
            for code, text in (data.name or {}).items()
            if text is not None and str(text).strip()
        }
        if not cleaned:
            raise ValidationError("Название нужно хотя бы на одном языке", field="name")
        hotel.name = cleaned

    hotel.latitude = latitude
    hotel.longitude = longitude
    # Пустые переводы не храним: город, которого нет ни на одном языке, — это
    # не город, а пустая подпись под погодой.
    if chosen is not None:
        hotel.city = chosen["city"]
        if chosen["timezone"]:
            hotel.timezone = chosen["timezone"]
    elif data.city:
        hotel.city = {code: text for code, text in data.city.items() if text}

    if data.temperature_units is not None:
        units = str(data.temperature_units).lower()
        if units not in dict(Hotel.TemperatureUnits.choices):
            raise ValidationError(
                "Единицы — «c» (Цельсий) или «f» (Фаренгейт)",
                field="temperature_units",
                code="bad_units",
            )
        hotel.temperature_units = units
    settings = dict(hotel.settings or {})
    home = dict(settings.get("home") or {})
    # Погоду нельзя включить без координат: включённый флаг без точки — это
    # блок, которого гость никогда не увидит, и вопрос «почему не работает».
    home["weather"] = bool(data.weather) and has_point
    home["room_status"] = bool(data.room_status)
    settings["home"] = home
    hotel.settings = settings
    hotel.save(
        update_fields=[
            "name", "latitude", "longitude", "city", "timezone", "temperature_units",
            "settings", "updated_at",
        ]
    )
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
