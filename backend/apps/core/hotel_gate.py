"""
Отель отключён или переехал — ответ на входе в запрос (партия 62-C).

ОТКЛЮЧЁН. Отель находится по адресу, но:
  * гостевые и отельные ручки отвечают 423 `hotel_disabled` — БЕЗ ПРИЧИНЫ:
    гостю «Отель временно не принимает заказы», сотруднику «Вход недоступен»;
  * открытая ручка состояния (`STATUS_PATHS`) отдаёт имя и бренд отеля — по
    ним приложение рисует заглушку в бренде, а не безликую ошибку.

ПЕРЕЕХАЛ. Адрес — прежний поддомен (`HotelSubdomainAlias`):
  * ручка состояния отвечает `moved` с новым адресом, и приложение уходит
    туда с тем же путём — так старые QR `/r/<номер>` ведут в новый адрес;
  * остальные ручки — 410 `hotel_moved` с тем же адресом.

Причина отключения сюда не попадает никогда: её знает только Control.
"""

from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse

STATUS_PATHS = ("/api/v1/hotel/status", "/api/hotel/status")
# Пути персонала: им — «Вход недоступен», а не «не принимает заказы».
STAFF_PREFIXES = ("/api/v1/staff/", "/api/staff/", "/api/v1/cms/", "/api/cms/", "/api/v1/tracker/", "/api/tracker/")

GUEST_TEXT = "Отель временно не принимает заказы"
STAFF_TEXT = "Вход недоступен"


def is_status_path(path: str) -> bool:
    return path.rstrip("/") in STATUS_PATHS


def disabled_response(hotel, path: str) -> JsonResponse:
    """423 без причины; ручка состояния — 200 с брендом для заглушки."""
    if is_status_path(path):
        return JsonResponse(_status(hotel, "disabled"))
    staff = path.startswith(STAFF_PREFIXES)
    return JsonResponse(
        {"detail": STAFF_TEXT if staff else GUEST_TEXT, "code": "hotel_disabled"},
        status=423,
    )


def active_status(hotel) -> JsonResponse:
    return JsonResponse(_status(hotel, "active"))


def _status(hotel, state: str) -> dict:
    from apps.core.context import tenant_context
    from apps.hotels.services.brand_services import get_or_create_brand

    with tenant_context(hotel):
        theme = get_or_create_brand(hotel)
    return {
        "state": state,
        # Все переводы: язык выбирает экран гостя, а не заголовок запроса.
        "name": (hotel.name or {}).get(hotel.default_language) if isinstance(hotel.name, dict) else hotel.name_i18n,
        "names": hotel.name if isinstance(hotel.name, dict) else {},
        "default_language": hotel.default_language,
        "theme": (theme.tokens if theme else {}) or {},
    }


def moved_response(host: str, old: str, path: str) -> JsonResponse | None:
    """Прежний поддомен → новый адрес отеля; None — такого перенаправления нет."""
    from apps.hotels.models import HotelSubdomainAlias

    alias = HotelSubdomainAlias.objects.select_related("hotel").filter(old=old, hotel__deleted_at__isnull=True).first()
    if alias is None:
        return None
    location = _new_base(host, old, alias.hotel.subdomain)
    body = {"state": "moved", "location": location, "code": "hotel_moved"}
    if is_status_path(path):
        return JsonResponse(body)
    return JsonResponse({**body, "detail": "Отель переехал на новый адрес"}, status=410)


def _new_base(host: str, old: str, new: str) -> str:
    """Тот же адрес, что пришёл, с новым поддоменом: база (и её порт) сохраняются."""
    from apps.core.hosts import normalize

    plain = normalize(host)
    rest = plain[len(old) :] if plain.startswith(old + ".") else f".{settings.GUEST_APP_BASE_DOMAIN}"
    port = host[len(plain) :] if host.lower().startswith(plain) else ""
    return f"{settings.GUEST_APP_PUBLIC_SCHEME}://{new}{rest}{port}"
