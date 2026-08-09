"""
Отель для гостевой витрины: бренд, языки, обложка, флаг управления номером.

Жил приватными функциями во вьюхе api/guest.py. Отдаётся и вместе с сессией, и
вместе с ошибкой «номер не найден»: на экране ошибки гость должен видеть бренд
своего отеля, а не голую системную страницу.
"""

from __future__ import annotations

from apps.hotels.models import Hotel


def _brand_cover_url(tokens: dict) -> str | None:
    """
    Обложка отеля из «Бренд и витрина» (R4): фон вида `image`.

    Отдаём отдельным полем, хотя url лежит и в токенах: парадная спрашивает
    «есть ли кадр отеля», а не «какой у него фон», и знать про устройство
    токенов ей незачем. Градиент и абстракция обложкой не являются — там
    парадная возьмёт фирменный градиент.
    """
    # Токены сюда приходят уже с пересобранными адресами (`resolve_media`):
    # строка в токенах переживает и смену публичного хоста медиа, и пересев
    # фотографий, а картинка за ней — нет.
    background = ((tokens or {}).get("brand") or {}).get("background") or {}
    if background.get("kind") != "image":
        return None
    return background.get("imageUrl") or None


def serialize_hotel(hotel: Hotel) -> dict:
    """
    Отдаём вместе с сессией и вместе с ошибкой «номер не найден»: на экране
    ошибки гость должен видеть бренд своего отеля, а не голую системную
    страницу.
    """
    from apps.hotels.services.brand_services import get_or_create_brand, resolve_media

    # Тема гарантированно есть: сервис заведёт её из пресета для отеля без
    # темы. Так витрина никогда не падает на платформенные цвета.
    #
    # Адреса картинок бренда пересобираются ЗДЕСЬ, до выдачи: гостю уезжает
    # рабочая ссылка, а не та, что осела в токенах при прошлом адресе стенда.
    theme = get_or_create_brand(hotel)
    tokens = resolve_media((theme.tokens if theme else {}) or {})
    languages = [
        {"code": language.code, "title": language.title or language.code.upper()}
        for language in hotel.hotellanguages.filter(is_active=True).order_by("sort_order")
    ]
    return {
        "id": str(hotel.pk),
        "name": hotel.name,
        "subdomain": hotel.subdomain,
        "currency": hotel.currency,
        "currency_minor_units": hotel.currency_minor_units,
        "timezone": hotel.timezone,
        "default_language": hotel.default_language,
        "languages": languages,
        "theme": tokens,
        # Обложка отеля для парадной главной (R5). Резолвим ассет здесь:
        # витрина не должна знать, как из id картинки получается url, и уж
        # тем более собирать его строкой.
        "cover_image": _brand_cover_url(tokens),
        # УЗКИЙ флаг, а не список модулей отеля. Гостю незачем знать платный
        # обвес: «у нас есть аналитика и PMS» — это разговор отеля с
        # платформой, а не с человеком в номере. Флаг отвечает ровно на один
        # вопрос фронта: показывать ли пункт «Номер».
        "room_control_enabled": _room_control_enabled(hotel),
    }


def _room_control_enabled(hotel: Hotel) -> bool:
    from apps.hotels.models import HotelModule
    from apps.hotels.module_registry import enabled_module_codes

    return HotelModule.Code.ROOM_CONTROL in enabled_module_codes(hotel)


def _session_payload(session, hotel: Hotel, *, token: str | None = None) -> dict:
    return {
        "token": token,
        "session_id": str(session.pk),
        "trust": session.trust,
        "expires_at": session.expires_at,
        "language": session.language or hotel.default_language,
        "room": session.room.number if session.room_id else None,
        "hotel": serialize_hotel(hotel),
    }
