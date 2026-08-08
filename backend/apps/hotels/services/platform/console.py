"""
Общее для платформенной консоли: выборка отеля, его сводка и записи в аудит.

Всё это жило приватными функциями во вьюхе `api/platform.py`. Перенос дословный:
ни одна проверка прав сюда НЕ переехала — права проверяет вьюха, и это
осознанно. Партия переносит раскладку, а не решает, кому что можно.

Сервисы не знают про HTTP: вместо `request` сюда приезжают идентификатор актора
и адрес, а разбирает запрос вьюха.
"""

from __future__ import annotations

from typing import Any

from apps.accounts.models import User
from apps.catalog.models import Item
from apps.core.context import platform_scope, tenant_context
from apps.core.errors import NotFoundError
from apps.core.models import AuditLog

from apps.hotels.models import Hotel, HotelLanguage, Room


def get_hotel(hotel_id: str) -> Hotel:
    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        raise NotFoundError("Отель не найден")
    return hotel


# --- Сводка ------------------------------------------------------------------


def counts(hotel: Hotel) -> dict[str, int]:
    # Считаем в контексте тенанта: RLS сам ограничивает выборку этим отелем.
    with tenant_context(hotel):
        return {
            "rooms": Room.objects.count(),
            "staff": User.objects.filter(is_staff_member=True).count(),
            "items": Item.objects.count(),
        }


def brief(hotel: Hotel) -> dict[str, Any]:
    return {
        "id": str(hotel.pk),
        "name": hotel.name,
        "subdomain": hotel.subdomain,
        "is_active": hotel.is_active,
        "created_at": hotel.created_at.isoformat(),
        "counts": counts(hotel),
    }


def list_briefs() -> list[dict[str, Any]]:
    return [brief(hotel) for hotel in Hotel.objects.order_by("-created_at")]


def profile(hotel: Hotel) -> dict[str, Any]:
    from apps.hotels.services.offboarding import offboarding_state

    with tenant_context(hotel):
        languages = [
            {"code": lang.code, "title": lang.title, "is_default": lang.is_default}
            for lang in HotelLanguage.objects.order_by("sort_order", "code")
        ]
    return {
        **brief(hotel),
        "timezone": hotel.timezone,
        "currency": hotel.currency,
        "default_language": hotel.default_language,
        "languages": languages,
        "tariff": hotel.tariff,
        # Состояние офбординга отдаём ОТДЕЛЬНЫМ полем, а не сырыми settings:
        # settings отеля — свалка внутренних ключей, и выставлять её наружу
        # значит однажды показать в интерфейсе что-то, чего там быть не должно.
        "offboarding": offboarding_state(hotel),
    }


def me(user: User) -> dict[str, Any]:
    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "is_platform_admin": True,
        "role": user.platform_role,
        "totp_enabled": user.totp_enabled,
    }


def member(user: User) -> dict[str, Any]:
    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.platform_role,
        "is_active": user.is_active,
        "totp_enabled": user.totp_enabled,
    }


# --- Записи в журнал ----------------------------------------------------------


def audit_platform(
    action: str,
    *,
    actor_id: Any = None,
    ip: str | None = None,
    payload: dict | None = None,
) -> None:
    """
    Запись действия, которое НЕ принадлежит отелю (вход, 2FA, команда).

    Пишется платформенным подключением: у таких строк hotel_id = NULL, а
    политика RLS показывает их только роли с BYPASSRLS — платформенной. Роль
    приложения не должна видеть журнал платформы даже случайно.
    """
    with platform_scope():
        AuditLog.all_objects.using("platform").create(
            hotel=None,
            actor_type=AuditLog.ActorType.PLATFORM,
            actor_id=actor_id,
            action=action,
            object_type="platform",
            payload=payload or {},
            ip_address=ip,
        )


def audit_hotel(
    hotel: Hotel,
    action: str,
    *,
    actor_id: Any,
    ip: str | None = None,
    payload: dict | None = None,
) -> None:
    with tenant_context(hotel):
        AuditLog.record(
            action,
            actor_type=AuditLog.ActorType.PLATFORM,
            actor_id=actor_id,
            object_type="hotel",
            object_id=hotel.pk,
            payload=payload or {},
            hotel_id=hotel.pk,
            ip_address=ip,
        )


# --- Правки уровня платформы --------------------------------------------------


def save_platform_user(user: User, **fields) -> None:
    """
    Запись строки платформенного админа. Идёт через платформенное подключение:
    у него hotel = NULL, и роль приложения его строку не видит из-за RLS.
    """
    for name, value in fields.items():
        setattr(user, name, value)
    with platform_scope():
        User.all_objects.using("platform").filter(pk=user.pk).update(**fields)


def find_platform_admin(email: str) -> User | None:
    """
    Поиск платформенного админа на входе. Ищем через платформенное подключение
    (BYPASSRLS) на базовом домене: у такого пользователя hotel = NULL, и обычный
    staff-логин, привязанный к тенанту, его не находит.
    """
    with platform_scope():
        return (
            User.all_objects.using("platform")
            .filter(email=email.strip().lower(), is_active=True, is_platform_admin=True)
            .first()
        )


def find_hotel_admin(hotel: Hotel) -> User | None:
    with tenant_context(hotel):
        return User.objects.filter(is_hotel_admin=True, is_active=True).order_by("created_at").first()


def replace_languages(hotel: Hotel, codes: list[str]) -> None:
    from apps.hotels.services.provisioning import _LANGUAGE_TITLES, _clean_languages

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


def delete_hotel_row(hotel: Hotel) -> None:
    """
    Удаление самой строки отеля вместе с его журналом.

    Журнал отеля уходит вместе с ним: он тенантный и без отеля не читается.
    Данные к этому моменту уже стёрты офбордингом — здесь только строка.
    """
    with platform_scope():
        AuditLog.all_objects.using("platform").filter(hotel_id=hotel.pk).delete()
    Hotel.objects.filter(pk=hotel.pk).delete()


def tariff_grid() -> list[dict[str, Any]]:
    from dataclasses import asdict

    from apps.hotels.services import tariffs as registry

    hotels = list(Hotel.objects.filter(origin=Hotel.Origin.LIVE))
    return [
        {
            "code": tariff.code,
            "title": tariff.title,
            "modules": list(tariff.modules),
            "limits": asdict(tariff.limits),
            "is_trial": tariff.is_trial,
            "trial_days": tariff.trial_days,
            "hotels": sum(1 for hotel in hotels if registry.get(hotel.tariff).code == tariff.code),
        }
        for tariff in registry.TARIFFS.values()
    ]
