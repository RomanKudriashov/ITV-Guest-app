"""
Резолюция тенанта и языка на входе в запрос.

Тенант определяется поддоменом: crystal.guest.localhost -> "crystal".
Это единственный способ в проде. В деве (DEBUG) дополнительно принимаются
заголовок X-Hotel-Subdomain и параметр ?hotel= — чтобы не поднимать
wildcard-DNS ради локальной разработки.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.http import JsonResponse

from .context import clear_request_context, set_request_context

logger = logging.getLogger(__name__)

# Пути, которым отель не нужен: платформенный уровень, health и документация.
PLATFORM_PATH_PREFIXES = (
    "/api/platform/",
    "/api/health",
    "/api/docs",
    "/api/openapi.json",
    "/static/",
)


def resolve_subdomain(host: str) -> str | None:
    """
    Отрезает базовый домен и возвращает поддомен отеля.

    Поддерживает и localhost-варианты (crystal.guest.localhost:8000), и
    голый localhost (тенанта нет → платформенный уровень).
    """
    host = (host or "").split(":", 1)[0].lower().strip(".")
    if not host:
        return None

    base = settings.GUEST_APP_BASE_DOMAIN.lower().strip(".")
    if base and host.endswith("." + base):
        subdomain = host[: -(len(base) + 1)]
    elif host == base:
        return None
    else:
        # Домен не наш (кастомный домен отеля или прямой IP) — берём первую
        # метку, если их больше одной. Для «localhost» вернётся None.
        parts = host.split(".")
        if len(parts) < 2:
            return None
        subdomain = parts[0]

    subdomain = subdomain.split(".")[-1] if subdomain else ""
    if not subdomain or subdomain in settings.GUEST_APP_RESERVED_SUBDOMAINS:
        return None
    return subdomain


class TenantMiddleware:
    """Ставит контекст отеля на весь запрос и гарантированно снимает после."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from apps.hotels.models import Hotel

        subdomain = None
        if settings.GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER:
            subdomain = request.headers.get("X-Hotel-Subdomain") or request.GET.get(
                "hotel"
            )
        subdomain = subdomain or resolve_subdomain(request.get_host())

        hotel = None
        if subdomain:
            hotel = Hotel.objects.filter(subdomain=subdomain, is_active=True).first()
            if hotel is None:
                return JsonResponse(
                    {"detail": f"Отель '{subdomain}' не найден", "code": "unknown_tenant"},
                    status=404,
                )

        is_platform_path = request.path.startswith(PLATFORM_PATH_PREFIXES)
        if hotel is None and not is_platform_path:
            return JsonResponse(
                {
                    "detail": (
                        "Не удалось определить отель. Открой приложение по адресу "
                        f"<отель>.{settings.GUEST_APP_BASE_DOMAIN}"
                        + (" или передай X-Hotel-Subdomain." if settings.DEBUG else ".")
                    ),
                    "code": "tenant_required",
                },
                status=400,
            )

        set_request_context(
            hotel=hotel,
            language=None,
            actor=None,
        )
        request.hotel = hotel
        try:
            return self.get_response(request)
        finally:
            # Соединения к БД переиспользуются между запросами — сессионную
            # переменную обязательно гасим, иначе следующий запрос унаследует
            # чужого тенанта.
            clear_request_context()


class LanguageMiddleware:
    """
    Язык гостя: ?lang= → Accept-Language → язык отеля по умолчанию → en.
    Отель может ограничивать список языков (HotelLanguage).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from .context import _language

        hotel = getattr(request, "hotel", None)
        language = self._pick(request, hotel)
        _language.set(language)
        request.language = language
        return self.get_response(request)

    def _pick(self, request, hotel) -> str:
        allowed = self._allowed_languages(hotel)

        explicit = request.GET.get("lang") or request.headers.get("X-Language")
        if explicit and explicit.lower() in allowed:
            return explicit.lower()

        for candidate in self._accept_language(request):
            if candidate in allowed:
                return candidate

        default = getattr(hotel, "default_language", None)
        if default and default in allowed:
            return default
        return settings.DEFAULT_LANGUAGE

    def _allowed_languages(self, hotel) -> list[str]:
        if hotel is None:
            return list(settings.SUPPORTED_LANGUAGES)

        from apps.hotels.models import HotelLanguage

        # Контекст тенанта уже выставлен TenantMiddleware, поэтому менеджер
        # сам отфильтрует по текущему отелю — фильтр руками не нужен.
        codes = list(
            HotelLanguage.objects.filter(is_active=True)
            .order_by("sort_order")
            .values_list("code", flat=True)
        )
        return codes or list(settings.SUPPORTED_LANGUAGES)

    @staticmethod
    def _accept_language(request) -> list[str]:
        """Разбирает Accept-Language, уважая q-веса. 'ru-RU' сводим к 'ru'."""
        header = request.headers.get("Accept-Language", "")
        weighted: list[tuple[float, str]] = []
        for chunk in header.split(","):
            part = chunk.strip()
            if not part:
                continue
            code, _, params = part.partition(";")
            quality = 1.0
            if params.strip().startswith("q="):
                try:
                    quality = float(params.strip()[2:])
                except ValueError:
                    quality = 0.0
            weighted.append((quality, code.strip().lower().split("-")[0]))
        weighted.sort(key=lambda item: item[0], reverse=True)
        return [code for _, code in weighted if code]
