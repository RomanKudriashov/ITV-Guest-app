"""
Платформенная консоль: управление отелями. Контракт — docs/platform-api-contract.md.

Работает на базовом домене под PlatformAuth (scope: platform). Все изменяющие
действия пишутся в AuditLog. Создание отеля — через единую точку
apps/hotels/provisioning.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest
from ninja import Router, Schema

from apps.catalog.models import Item
from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.core.errors import NotFoundError
from apps.core.models import AuditLog
from apps.hotels.models import ExecutionPoint, Hotel, HotelLanguage, Room
from apps.hotels.provisioning import provision_hotel, set_hotel_admin

router = Router(tags=["platform"])


# --- Схемы -----------------------------------------------------------------


class HotelCreateIn(Schema):
    subdomain: str
    name: str
    admin_email: str
    timezone: str = "Europe/Moscow"
    currency: str = "RUB"
    languages: list[str] = ["ru", "en"]
    preset: str = "midnight_navy"
    admin_password: str | None = None


class HotelPatchIn(Schema):
    name: str | None = None
    timezone: str | None = None
    currency: str | None = None
    languages: list[str] | None = None
    is_active: bool | None = None


class AdminIn(Schema):
    email: str
    password: str | None = None


class PlatformLoginIn(Schema):
    email: str
    password: str


# --- Вход платформенного админа --------------------------------------------

# Отдельно от /staff/auth/login: у платформенного админа hotel = NULL, и обычный
# staff-логин (привязанный к тенанту) его не пускает. Ищем через платформенное
# подключение (BYPASSRLS) на базовом домене.
@router.post("/auth/login", auth=None, response={200: dict, 401: dict}, summary="Вход платформенного админа")
def platform_login(request: HttpRequest, payload: PlatformLoginIn):
    from django.contrib.auth.hashers import check_password

    from apps.accounts.tokens import encode_refresh_token, encode_staff_token
    from apps.core.context import platform_scope

    with platform_scope():
        user = (
            User.all_objects.using("platform")
            .filter(email=payload.email.strip().lower(), is_active=True, is_platform_admin=True)
            .first()
        )
    if user is None or not check_password(payload.password, user.password):
        return 401, {"detail": "Неверный логин или пароль", "code": "auth_failed"}
    return 200, {
        "access": encode_staff_token(user),
        "refresh": encode_refresh_token(user),
        "user": {"id": str(user.pk), "email": user.email, "is_platform_admin": True},
    }


# --- Сериализация ----------------------------------------------------------


def _counts(hotel: Hotel) -> dict[str, int]:
    # Считаем в контексте тенанта: RLS сам ограничивает выборку этим отелем.
    with tenant_context(hotel):
        return {
            "rooms": Room.objects.count(),
            "staff": User.objects.filter(is_staff_member=True).count(),
            "items": Item.objects.count(),
        }


def _brief(hotel: Hotel) -> dict[str, Any]:
    return {
        "id": str(hotel.pk),
        "name": hotel.name,
        "subdomain": hotel.subdomain,
        "is_active": hotel.is_active,
        "created_at": hotel.created_at.isoformat(),
        "counts": _counts(hotel),
    }


def _profile(hotel: Hotel) -> dict[str, Any]:
    with tenant_context(hotel):
        languages = [
            {"code": lang.code, "title": lang.title, "is_default": lang.is_default}
            for lang in HotelLanguage.objects.order_by("sort_order", "code")
        ]
    return {
        **_brief(hotel),
        "timezone": hotel.timezone,
        "currency": hotel.currency,
        "default_language": hotel.default_language,
        "languages": languages,
    }


def _get_hotel(hotel_id: str) -> Hotel:
    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        raise NotFoundError("Отель не найден")
    return hotel


def _audit(request: HttpRequest, hotel: Hotel, action: str, payload: dict | None = None) -> None:
    with tenant_context(hotel):
        AuditLog.record(
            action,
            actor_type=AuditLog.ActorType.PLATFORM,
            actor_id=request.user.pk,
            object_type="hotel",
            object_id=hotel.pk,
            payload=payload or {},
            hotel_id=hotel.pk,
            ip_address=request.META.get("REMOTE_ADDR"),
        )


# --- Ручки -----------------------------------------------------------------


@router.get("/hotels", summary="Список отелей")
def list_hotels(request: HttpRequest):
    return [_brief(h) for h in Hotel.objects.order_by("-created_at")]


@router.post("/hotels", response={201: dict}, summary="Создать отель")
def create_hotel(request: HttpRequest, payload: HotelCreateIn):
    result = provision_hotel(
        subdomain=payload.subdomain,
        name=payload.name,
        admin_email=payload.admin_email,
        timezone=payload.timezone,
        currency=payload.currency,
        languages=payload.languages,
        preset=payload.preset,
        admin_password=payload.admin_password,
        exist_ok=False,
    )
    _audit(request, result.hotel, "platform.hotel.created", {"subdomain": result.hotel.subdomain})
    return 201, {
        "hotel": _profile(result.hotel),
        "admin": {"email": result.admin.email, "password": result.admin_password},
    }


@router.get("/hotels/{hotel_id}", summary="Профиль отеля")
def get_hotel(request: HttpRequest, hotel_id: str):
    return _profile(_get_hotel(hotel_id))


@router.patch("/hotels/{hotel_id}", summary="Изменить профиль отеля")
def patch_hotel(request: HttpRequest, hotel_id: str, payload: HotelPatchIn):
    hotel = _get_hotel(hotel_id)
    data = payload.dict(exclude_unset=True)
    fields: list[str] = []
    for attr in ("name", "timezone", "currency"):
        if attr in data and data[attr] is not None:
            setattr(hotel, attr, data[attr])
            fields.append(attr)

    activation_change = None
    if "is_active" in data and data["is_active"] is not None and data["is_active"] != hotel.is_active:
        hotel.is_active = data["is_active"]
        fields.append("is_active")
        activation_change = "activated" if hotel.is_active else "deactivated"

    if fields:
        hotel.save(update_fields=[*fields, "updated_at"])

    if "languages" in data and data["languages"] is not None:
        _replace_languages(hotel, data["languages"])

    if fields or "languages" in data:
        _audit(request, hotel, "platform.hotel.updated", {"fields": fields})
    if activation_change:
        _audit(request, hotel, f"platform.hotel.{activation_change}")

    return _profile(hotel)


@router.post("/hotels/{hotel_id}/admins", summary="Завести/сбросить hotel-admin")
def set_admin(request: HttpRequest, hotel_id: str, payload: AdminIn):
    hotel = _get_hotel(hotel_id)
    user, password = set_hotel_admin(hotel, email=payload.email, password=payload.password)
    _audit(request, hotel, "platform.hotel.admin_set", {"email": user.email})
    return {"email": user.email, "password": password}


def _replace_languages(hotel: Hotel, codes: list[str]) -> None:
    from apps.hotels.provisioning import _LANGUAGE_TITLES, _clean_languages

    codes = _clean_languages(codes)
    default_language = codes[0]
    with tenant_context(hotel):
        for order, code in enumerate(codes):
            HotelLanguage.objects.update_or_create(
                code=code,
                defaults={
                    "title": _LANGUAGE_TITLES.get(code, code.upper()),
                    "is_default": code == default_language,
                    "sort_order": order,
                },
            )
        HotelLanguage.objects.exclude(code__in=codes).delete()
    if hotel.default_language != default_language:
        hotel.default_language = default_language
        hotel.save(update_fields=["default_language", "updated_at"])
