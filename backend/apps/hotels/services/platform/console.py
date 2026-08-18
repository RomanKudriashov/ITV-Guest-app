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
from django.db.models import Q
from django.utils import timezone

from apps.core.models import AuditLog

from apps.hotels.models import Hotel, HotelLanguage, Room


def get_hotel(hotel_id: str) -> Hotel:
    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        raise NotFoundError("Отель не найден")
    return hotel


# --- Сводка ------------------------------------------------------------------


def counts(hotel: Hotel) -> dict[str, int]:
    """
    Счётчики ОДНОГО отеля — для карточки, где отель ровно один.

    В списках так считать нельзя: три запроса на отель превращаются в тысячу
    на двухстах. Списки берут `_batch_counts` из fleet — там один запрос на
    сущность независимо от числа отелей.
    """
    with tenant_context(hotel):
        return {
            "rooms": Room.objects.count(),
            "staff": User.objects.filter(is_staff_member=True).count(),
            "items": Item.objects.count(),
        }


def brief(hotel: Hotel, counts_override: dict[str, int] | None = None) -> dict[str, Any]:
    return {
        "id": str(hotel.pk),
        "name": hotel.name_i18n,
        "subdomain": hotel.subdomain,
        "is_active": hotel.is_active,
        "created_at": hotel.created_at.isoformat(),
        "counts": counts_override if counts_override is not None else counts(hotel),
    }


def list_briefs(*, limit: int | None = None) -> dict[str, Any]:
    """
    Список отелей: счёт БАТЧЕМ и с пределом.

    Было `[brief(hotel) for hotel in ...]` — по три запроса на отель плюс
    переключение тенанта. Замерено на двухстах отелях: 1064 запроса, 1.3 с,
    и это на пустых отелях; с наполнением было бы хуже.

    Число запросов теперь не зависит от числа отелей — ровно как во «флоте»,
    откуда и взят батч. Предел — потому что двести отелей это не потолок, а
    сегодняшнее состояние стенда.
    """
    from apps.hotels.services.platform.fleet import _batch_counts
    from apps.hotels.services.platform.paging import clamp, envelope

    limit = clamp(limit)
    with platform_scope():
        total = Hotel.objects.using("platform").count()
        hotels = list(Hotel.objects.using("platform").order_by("-created_at")[:limit])
    counts_by_hotel = _batch_counts([hotel.pk for hotel in hotels])
    rows = [
        brief(
            hotel,
            {
                key: counts_by_hotel.get(hotel.pk, {}).get(key, 0)
                for key in ("rooms", "staff", "items")
            },
        )
        for hotel in hotels
    ]
    return envelope(rows, total, limit)


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
        # Размерность валюты — часть ответа: без неё интерфейс не может ни
        # показать цену, ни дать её отредактировать, и «100» одинаково значит
        # рубль и сто иен.
        "currency_minor_units": hotel.currency_minor_units,
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


def replace_languages(hotel: Hotel, codes: list[str]) -> dict | None:
    """
    Заменить набор языков отеля и сказать, что изменилось.

    Возвращает `{"from": [...], "to": [...]}` или None, если набор совпал.
    Снимок «до» берётся ЗДЕСЬ, а не во вьюхе: обращение к ORM из обработчика
    запроса ловит сеть безопасности, и ловит правильно — иначе половина логики
    расползается по вьюхам, где её не найти.
    """
    from apps.hotels.services.provisioning import _LANGUAGE_TITLES, _clean_languages

    codes = _clean_languages(codes)
    default_language = codes[0]
    with tenant_context(hotel):
        was = list(HotelLanguage.objects.order_by("sort_order").values_list("code", flat=True))
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
        became = list(HotelLanguage.objects.order_by("sort_order").values_list("code", flat=True))
    if hotel.default_language != default_language:
        hotel.default_language = default_language
        hotel.save(update_fields=["default_language", "updated_at"])
    return {"from": was, "to": became} if was != became else None


def delete_hotel_row(hotel: Hotel) -> None:
    """
    Мягкое удаление строки отеля и скрытие его журнала.

    Ни то, ни другое не стирается физически. `AuditLog.delete()` мягкое:
    записи остаются в таблице с проставленным `deleted_at` и читаются через
    `all_objects` — журнал скрывается из выдач, а не исчезает. Строка отеля
    тоже остаётся: платформа обязана уметь ответить, что отель был.

    Что действительно происходит необратимо — стирание ДАННЫХ отеля, и делает
    это офбординг до вызова этой функции.

    Поддомен при этом освобождается: `Hotel.delete()` переименовывает его в
    припаркованный вид, а прежнее имя кладёт в `former_subdomain`.
    """
    with platform_scope():
        AuditLog.all_objects.using("platform").filter(hotel_id=hotel.pk).delete()
    Hotel.objects.filter(pk=hotel.pk).delete()


def active_impersonations(
    *,
    search: str = "",
    state: str = "active",
    limit: int | None = None,
    offset: int = 0,
) -> dict[str, Any]:
    """
    Сессии поддержки по всем отелям.

    Читаем платформенным подключением: грант тенантный, а вопрос «кто сейчас
    внутри отелей» задаётся поверх них.

    `state` — что показывать. Раньше выдача была только «активные», и разбор
    инцидента упирался в стену: кто заходил вчера, узнать было негде, хотя
    записи никуда не делись. `history` — завершённые (отозванные и истёкшие),
    `all` — и те и другие.

    Поиск по ПОДДОМЕНУ отеля и ПОЧТЕ вошедшего: по ним сессию и разыскивают.
    """
    from apps.accounts.models import ImpersonationGrant
    from apps.core.listing import page as list_page, search as apply_search

    now = timezone.now()
    with platform_scope():
        queryset = ImpersonationGrant.all_objects.using("platform").select_related(
            "actor", "target_user", "hotel"
        )
        if state == "history":
            # Завершённая — отозванная ЛИБО истёкшая по сроку.
            queryset = queryset.filter(
                Q(revoked_at__isnull=False) | Q(expires_at__lte=now)
            ).order_by("-created_at")
        elif state == "all":
            queryset = queryset.order_by("-created_at")
        else:
            queryset = queryset.filter(
                revoked_at__isnull=True, expires_at__gt=now
            ).order_by("expires_at")

        queryset = apply_search(
            queryset, search, ("hotel__subdomain", "actor_email", "target_user__email")
        )
        return list_page(
            queryset, limit=limit, offset=offset, serialize=_impersonation_row
        )


def _impersonation_row(grant) -> dict[str, Any]:
    return {
        "id": str(grant.pk),
        # И имя, и идентификатор: имя читают глазами, по идентификатору
        # карточка отеля отбирает свои сессии.
        "hotel_id": str(grant.hotel_id) if grant.hotel_id else "",
        "hotel": grant.hotel.name_i18n if grant.hotel_id else "",
        "subdomain": grant.hotel.subdomain if grant.hotel_id else "",
        "actor": grant.actor_email or (grant.actor.email if grant.actor_id else ""),
        "as_user": grant.target_user.email if grant.target_user_id else "",
        "reason": grant.reason,
        "started_at": grant.created_at.isoformat(),
        "expires_at": grant.expires_at.isoformat(),
        # Забрал ли вошедший токен. Код мог остаться непотраченным — вкладку
        # закрыли, ссылку не открыли.
        "entered": grant.exchanged_at is not None,
        # Чем кончилась: для истории это и есть главный столбец.
        "revoked_at": grant.revoked_at.isoformat() if grant.revoked_at else None,
    }


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
