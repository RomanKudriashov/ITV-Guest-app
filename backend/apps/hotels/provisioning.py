"""
Создание отеля на платформенном уровне: минимальный рабочий каркас тенанта.

Единственная точка создания отеля. Ею пользуются и платформенная консоль/CLI
(`create_hotel`, `POST /api/v1/platform/hotels`), и демо-сид (`seed_demo_hotel`
кладёт демо-контент ПОВЕРХ этого каркаса, а не дублирует создание).

Каркас = ровно то, чего достаточно, чтобы отель заработал: hotel, языки,
бренд-тема из пресета, один отдел (ресепшен) и первый hotel-admin. Остальное
(меню, номера, каналы) заводит hotel-admin в CMS.

RLS: сам `Hotel` — платформенная таблица (без RLS). Зависимые строки создаются
внутри `tenant_context(hotel)` — сессионная переменная тенанта позволяет роли
приложения вставлять строки нового отеля и гарантирует изоляцию: из-под чужого
тенанта эти строки не видны.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from django.db import IntegrityError, transaction

from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.core.errors import ConflictError, ValidationError
from apps.hotels.brand_library import preset_tokens
from apps.hotels.models import BrandTheme, ExecutionPoint, Hotel, HotelLanguage

DEFAULT_PRESET = "midnight_navy"
DEFAULT_LANGUAGES = ("ru", "en")

_LANGUAGE_TITLES = {"ru": "Русский", "en": "English", "ar": "العربية", "zh": "中文"}


@dataclass(slots=True)
class ProvisionResult:
    hotel: Hotel
    admin: User
    #: Пароль возвращается ТОЛЬКО когда он был сгенерирован/задан сейчас —
    #: показать его один раз и не хранить в открытом виде.
    admin_password: str | None
    created: bool


def _generate_password() -> str:
    return secrets.token_urlsafe(12)


def _clean_languages(languages) -> list[str]:
    seen: list[str] = []
    for code in languages:
        code = str(code).strip().lower()
        if code and code not in seen:
            seen.append(code)
    if not seen:
        raise ValidationError("Нужен хотя бы один язык", field="languages")
    return seen


def seed_item_data_dictionaries() -> None:
    """
    Засеять системные аллергены (14 обязательных) и диетические маркеры с нашими
    переводами. Идемпотентно (get_or_create по коду), под текущим тенантом.
    Системные пометки не даём удалить в CMS; отель может деактивировать.
    """
    from apps.catalog.models import Allergen, DietaryMarker
    from apps.catalog.vocabularies import ALLERGENS, DIETARY_MARKERS

    for order, entry in enumerate(ALLERGENS):
        Allergen.objects.get_or_create(
            code=entry["code"],
            defaults={"title": entry["title"], "is_system": True, "sort_order": order},
        )
    for order, entry in enumerate(DIETARY_MARKERS):
        DietaryMarker.objects.get_or_create(
            code=entry["code"],
            defaults={"title": entry["title"], "is_system": True, "sort_order": order},
        )


@transaction.atomic
def provision_hotel(
    *,
    subdomain: str,
    name: str,
    admin_email: str,
    timezone: str = "Europe/Moscow",
    currency: str = "RUB",
    languages=DEFAULT_LANGUAGES,
    preset: str = DEFAULT_PRESET,
    admin_password: str | None = None,
    exist_ok: bool = False,
) -> ProvisionResult:
    """
    Заводит минимальный каркас отеля одной транзакцией (всё-или-ничего).

    `exist_ok=False` (консоль/CLI): существующий subdomain → ConflictError, без
    полу-созданного отеля. `exist_ok=True` (сид): дозаполняет недостающее
    идемпотентно.
    """
    subdomain = subdomain.strip().lower()
    name = name.strip()
    admin_email = admin_email.strip().lower()
    if not subdomain:
        raise ValidationError("Нужен поддомен", field="subdomain")
    if not name:
        raise ValidationError("Нужно название", field="name")
    if not admin_email:
        raise ValidationError("Нужен email администратора", field="admin_email")

    tokens = preset_tokens(preset)
    if tokens is None:
        raise ValidationError(f"Неизвестный пресет: {preset}", field="preset")

    langs = _clean_languages(languages)
    default_language = langs[0]

    existing = Hotel.objects.filter(subdomain=subdomain).first()
    if existing is not None and not exist_ok:
        raise ConflictError(
            f"Отель с поддоменом «{subdomain}» уже существует",
            code="hotel_exists",
        )

    hotel = existing or Hotel.objects.create(
        subdomain=subdomain,
        name=name,
        timezone=timezone,
        currency=currency,
        default_language=default_language,
    )
    created = existing is None
    admin_password_out: str | None = None

    with tenant_context(hotel):
        for order, code in enumerate(langs):
            HotelLanguage.objects.get_or_create(
                code=code,
                defaults={
                    "title": _LANGUAGE_TITLES.get(code, code.upper()),
                    "is_default": code == default_language,
                    "sort_order": order,
                },
            )

        theme, _ = BrandTheme.objects.get_or_create(
            name=f"{name} — основная",
            defaults={"tokens": tokens, "is_preset": False},
        )
        if hotel.default_theme_id != theme.pk:
            hotel.default_theme = theme
            hotel.save(update_fields=["default_theme", "updated_at"])

        ExecutionPoint.objects.get_or_create(
            code="reception",
            defaults={
                "kind": ExecutionPoint.Kind.RECEPTION,
                "title": {"ru": "Ресепшен", "en": "Reception"},
                "sla_minutes": 15,
            },
        )

        seed_item_data_dictionaries()

        admin = User.objects.filter(email=admin_email).first()
        if admin is None:
            admin_password_out = admin_password or _generate_password()
            try:
                admin = User.objects.create_user(
                    email=admin_email,
                    password=admin_password_out,
                    hotel=hotel,
                    is_hotel_admin=True,
                    is_staff_member=True,
                    language=default_language,
                )
            except IntegrityError as exc:
                # email глобально уникален — коллизия с админом другого отеля.
                raise ConflictError(
                    f"Пользователь с email «{admin_email}» уже существует",
                    code="admin_email_taken",
                ) from exc
        elif admin_password:
            admin.set_password(admin_password)
            admin.save(update_fields=["password"])
            admin_password_out = admin_password

    return ProvisionResult(
        hotel=hotel, admin=admin, admin_password=admin_password_out, created=created
    )


def ensure_platform_admin(*, email: str, password: str) -> User:
    """
    Завести/обновить супер-админа платформы (hotel = NULL). Такую строку роль
    приложения не видит из-за RLS, поэтому создаём через платформенное
    подключение (BYPASSRLS).
    """
    from apps.core.context import platform_scope

    email = email.strip().lower()
    with platform_scope():
        user = User.all_objects.using("platform").filter(email=email).first()
        if user is None:
            user = User.objects.db_manager("platform").create_superuser(
                email=email, password=password
            )
        else:
            user.set_password(password)
            user.is_platform_admin = True
            user.is_active = True
            user.save(using="platform")
    return user


@transaction.atomic
def set_hotel_admin(hotel: Hotel, *, email: str, password: str | None = None) -> tuple[User, str]:
    """
    Завести нового hotel-admin или сбросить пароль существующему. Всегда
    возвращает пароль (заданный или сгенерированный) — показать один раз.
    """
    email = email.strip().lower()
    if not email:
        raise ValidationError("Нужен email", field="email")
    new_password = password or _generate_password()

    with tenant_context(hotel):
        user = User.objects.filter(email=email).first()
        if user is None:
            try:
                user = User.objects.create_user(
                    email=email,
                    password=new_password,
                    hotel=hotel,
                    is_hotel_admin=True,
                    is_staff_member=True,
                    language=hotel.default_language,
                )
            except IntegrityError as exc:
                raise ConflictError(
                    f"Пользователь с email «{email}» уже существует",
                    code="admin_email_taken",
                ) from exc
        else:
            user.set_password(new_password)
            user.is_hotel_admin = True
            user.is_active = True
            user.save()

    return user, new_password
