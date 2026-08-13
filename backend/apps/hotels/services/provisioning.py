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
from apps.hotels.models import BrandTheme, ExecutionPoint, Hotel, HotelLanguage, Service
from apps.orders.services.status_flows import ensure_status_flows

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
    name: str | dict,
    admin_email: str,
    timezone: str = "Europe/Moscow",
    currency: str = "RUB",
    languages=DEFAULT_LANGUAGES,
    preset: str = DEFAULT_PRESET,
    admin_password: str | None = None,
    exist_ok: bool = False,
    origin: str = Hotel.Origin.LIVE,
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

    # Название переводимое. Строку принимаем ради вызывающих, которым язык один
    # (`manage.py create_hotel`, старые сиды): она кладётся в язык отеля по
    # умолчанию, а не в жёстко зашитый русский.
    if isinstance(name, dict):
        name_translations = {
            code: str(text).strip()
            for code, text in name.items()
            if text is not None and str(text).strip()
        }
    else:
        name_translations = {default_language: str(name).strip()} if name else {}
    if not name_translations:
        raise ValidationError("Название нужно хотя бы на одном языке", field="name")

    existing = Hotel.objects.filter(subdomain=subdomain).first()
    if existing is not None and not exist_ok:
        raise ConflictError(
            f"Отель с поддоменом «{subdomain}» уже существует",
            code="hotel_exists",
        )

    hotel = existing or Hotel.objects.create(
        subdomain=subdomain,
        name=name_translations,
        timezone=timezone,
        currency=currency,
        default_language=default_language,
        # Происхождение проставляется ЗДЕСЬ, в единственной точке создания
        # отеля: любой другой способ завести отель мимо провижининга сделал бы
        # признак необязательным, а необязательному признаку чистка доверять
        # не может.
        origin=origin,
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

        reception, _ = ExecutionPoint.objects.get_or_create(
            code="reception",
            defaults={
                "kind": ExecutionPoint.Kind.RECEPTION,
                "title": {"ru": "Ресепшен", "en": "Reception", "ar": "الاستقبال", "zh": "前台"},
                "sla_minutes": 15,
            },
        )
        # Сервис-контейнер исполнителя (1:1). Каркасный ресепшен без категорий
        # на витрине не появляется, но инвариант «у каждого исполнителя есть
        # сервис» держим с самого создания отеля.
        # Имя даём на всех языках отеля сразу. Без него CMS показывала сервис
        # по КОДУ — латинское «reception» в списке русских названий: у точки
        # исполнения перевод был, а у её сервиса нет, и подпись бралась откуда
        # придётся.
        reception_name = {
            "ru": "Ресепшен",
            "en": "Reception",
            "ar": "الاستقبال",
            "zh": "前台",
        }
        reception_service, created_service = Service.objects.get_or_create(
            execution_point=reception,
            defaults={
                "code": reception.code,
                "type": Service.Type.CONCIERGE,
                "public_name": reception_name,
            },
        )
        # Починка уже заведённых отелей: на стендах, созданных до этой правки,
        # сервис ресепшена лежит без имени, и `get_or_create` его не тронет.
        if not created_service and not reception_service.public_name:
            reception_service.public_name = reception_name
            reception_service.save(update_fields=["public_name", "updated_at"])

        seed_item_data_dictionaries()
        # Пресеты статусов — часть каркаса отеля, а не демо-контента. До R3 они
        # жили только в демо-сиде, и свежесозданный отель падал на первом заказе
        # («status_preset_missing»). Теперь заводятся все четыре потока сразу:
        # какой понадобится, решает тип сервиса.
        ensure_status_flows()

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
def change_hotel_admin_email(hotel: Hotel, *, current_email: str, new_email: str) -> User:
    """
    Сменить адрес администратора отеля, НИЧЕГО на него не отправляя.

    Это выход из положения «отель потерял и почту тоже»: пароль уходит только
    администратору, и недоступный адрес иначе запирал бы отель насмерть.
    Отправлять сюда письмо бессмысленно — старый ящик и есть то, что потеряно.
    """
    current = (current_email or "").strip().lower()
    new_email = (new_email or "").strip().lower()
    if not new_email or "@" not in new_email:
        raise ValidationError("Нужен корректный новый адрес", field="new_email")
    if new_email == current:
        raise ValidationError("Новый адрес совпадает с текущим", field="new_email")

    with tenant_context(hotel):
        user = User.objects.filter(email=current, is_hotel_admin=True).first()
        if user is None:
            raise ValidationError(
                "У отеля нет администратора с таким адресом", field="current_email"
            )
        # Адрес уникален глобально: занят — значит увели бы чужого пользователя.
        if User.all_objects.filter(email=new_email).exists():
            raise ConflictError(
                f"Пользователь с email «{new_email}» уже существует",
                code="admin_email_taken",
            )
        user.email = new_email
        user.save(update_fields=["email", "updated_at"])
    return user


@transaction.atomic
def set_hotel_admin(hotel: Hotel, *, email: str, password: str | None = None) -> tuple[User, dict]:
    """
    Завести нового hotel-admin или сбросить пароль существующему.

    Пароль УХОДИТ АДМИНИСТРАТОРУ ПИСЬМОМ и наружу не возвращается: вернуть его
    вызывающему значит показать оператору платформы ключ от чужой CMS. Второй
    элемент кортежа — то, что можно показать: адрес и момент отправки.

    Отправка идёт ВНУТРИ этой транзакции намеренно. Отказ почты бросает
    исключение, транзакция откатывается, и пароль остаётся прежним. Обратный
    порядок (сначала сохранить, потом отправить) оставлял бы админа с
    работающим сбросом и без пароля — то есть запирал бы отель.
    """
    from apps.hotels.services.admin_credentials import send_admin_password

    email = email.strip().lower()
    if not email:
        raise ValidationError("Нужен email", field="email")
    new_password = password or _generate_password()

    with tenant_context(hotel):
        user = User.objects.filter(email=email).first()
        is_new = user is None
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

    delivery = send_admin_password(hotel, email=email, password=new_password, is_new=is_new)
    return user, delivery
