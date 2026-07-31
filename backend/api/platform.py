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
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import ExecutionPoint, Hotel, HotelLanguage, Room
from apps.hotels.module_registry import list_modules, set_modules
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
    tariff: str | None = None


class AdminIn(Schema):
    email: str
    password: str | None = None


class ModuleEntryIn(Schema):
    code: str
    is_enabled: bool = False
    source: str = "tariff"
    config: dict = {}


class ModulesIn(Schema):
    modules: list[ModuleEntryIn] = []
    tariff: str | None = None


class PlatformLoginIn(Schema):
    email: str
    password: str
    # Второй фактор. Приходит вторым шагом — первый отвечает `mfa_required`.
    totp_code: str | None = None


class TotpEnableIn(Schema):
    code: str


# --- Вход платформенного админа --------------------------------------------

# Отдельно от /staff/auth/login: у платформенного админа hotel = NULL, и обычный
# staff-логин (привязанный к тенанту) его не пускает. Ищем через платформенное
# подключение (BYPASSRLS) на базовом домене.
@router.post("/auth/login", auth=None, response={200: dict, 401: dict, 403: dict}, summary="Вход платформенного админа")
def platform_login(request: HttpRequest, payload: PlatformLoginIn):
    from django.contrib.auth.hashers import check_password

    from apps.accounts.platform_access import client_ip, ip_allowed
    from apps.accounts.tokens import encode_refresh_token, encode_staff_token
    from apps.accounts.totp import verify as verify_totp
    from apps.core.context import platform_scope

    # Рубеж «откуда» проверяем и на входе: иначе с чужой сети можно было бы
    # перебирать пароли, узнавая по ответу, какой из них верный.
    if not ip_allowed(request):
        return 403, {
            "detail": "Вход в платформу с этого адреса запрещён",
            "code": "ip_not_allowed",
            "ip": client_ip(request),
        }

    with platform_scope():
        user = (
            User.all_objects.using("platform")
            .filter(email=payload.email.strip().lower(), is_active=True, is_platform_admin=True)
            .first()
        )
    if user is None or not check_password(payload.password, user.password):
        return 401, {"detail": "Неверный логин или пароль", "code": "auth_failed"}

    if user.totp_enabled:
        if not payload.totp_code:
            # Не ошибка, а второй шаг: пароль принят, ждём код.
            return 401, {"detail": "Нужен код подтверждения", "code": "mfa_required"}
        if not verify_totp(user.totp_secret, payload.totp_code):
            return 401, {"detail": "Неверный код подтверждения", "code": "mfa_invalid"}

    _audit_platform(request, "platform.login", actor=user, payload={"mfa": user.totp_enabled})
    return 200, {
        "access": encode_staff_token(user, mfa=user.totp_enabled),
        "refresh": encode_refresh_token(user),
        "user": _me(user),
    }


def _me(user: User) -> dict[str, Any]:
    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "is_platform_admin": True,
        "role": user.platform_role,
        "totp_enabled": user.totp_enabled,
    }


@router.get("/auth/me", summary="Текущий платформенный админ")
def platform_me(request: HttpRequest):
    return _me(request.user)


# --- Управление вторым фактором --------------------------------------------


@router.post("/auth/2fa/setup", summary="Завести секрет 2FA (показать QR)")
def totp_setup(request: HttpRequest):
    from apps.accounts.totp import generate_secret, provisioning_uri

    user = request.user
    if user.totp_enabled:
        raise ValidationError("2FA уже включена", field="totp")
    # Секрет пересоздаём на каждый заход в мастер: незавершённая прошлая
    # попытка не должна оставлять пригодный секрет, который никто не помнит.
    secret = generate_secret()
    _save_platform_user(user, totp_secret=secret)
    return {"secret": secret, "otpauth_url": provisioning_uri(secret, account=user.email)}


@router.post("/auth/2fa/enable", summary="Включить 2FA, подтвердив кодом")
def totp_enable(request: HttpRequest, payload: TotpEnableIn):
    from apps.accounts.tokens import encode_staff_token
    from apps.accounts.totp import verify as verify_totp

    user = request.user
    if not user.totp_secret:
        raise ValidationError("Сначала заведите секрет", field="totp")
    if not verify_totp(user.totp_secret, payload.code):
        raise ValidationError("Код не подошёл", field="code")
    _save_platform_user(user, totp_enabled=True)
    _audit_platform(request, "platform.2fa.enabled")
    # Выдаём новый токен с признаком: текущий выписан до включения 2FA и
    # перестанет действовать — иначе включивший 2FA выкинул бы сам себя.
    return {"ok": True, "access": encode_staff_token(user, mfa=True)}


@router.post("/auth/2fa/disable", summary="Выключить 2FA")
def totp_disable(request: HttpRequest):
    user = request.user
    _save_platform_user(user, totp_enabled=False, totp_secret="")
    _audit_platform(request, "platform.2fa.disabled")
    return {"ok": True}


def _save_platform_user(user: User, **fields) -> None:
    """
    Запись строки платформенного админа. Идёт через платформенное подключение:
    у него hotel = NULL, и роль приложения его строку не видит из-за RLS.
    """
    from apps.core.context import platform_scope

    for name, value in fields.items():
        setattr(user, name, value)
    with platform_scope():
        User.all_objects.using("platform").filter(pk=user.pk).update(**fields)


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
        "tariff": hotel.tariff,
    }


def _get_hotel(hotel_id: str) -> Hotel:
    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        raise NotFoundError("Отель не найден")
    return hotel


def _audit_platform(
    request: HttpRequest,
    action: str,
    *,
    actor: User | None = None,
    payload: dict | None = None,
) -> None:
    """
    Запись действия, которое НЕ принадлежит отелю (вход, 2FA, команда).

    Пишется платформенным подключением: у таких строк hotel_id = NULL, а
    политика RLS показывает их только роли с BYPASSRLS — платформенной. Роль
    приложения не должна видеть журнал платформы даже случайно.
    """
    from apps.core.context import platform_scope

    who = actor or getattr(request, "user", None)
    with platform_scope():
        AuditLog.all_objects.using("platform").create(
            hotel=None,
            actor_type=AuditLog.ActorType.PLATFORM,
            actor_id=getattr(who, "pk", None),
            action=action,
            object_type="platform",
            payload=payload or {},
            ip_address=request.META.get("REMOTE_ADDR"),
        )


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
    for attr in ("name", "timezone", "currency", "tariff"):
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


# --- Реестр модулей --------------------------------------------------------
# Данные + API (R1). Управляющий UI — R6, гейтинг CMS-навигации — R4.
# Контракт — docs/module-registry-api-contract.md.


@router.get("/hotels/{hotel_id}/modules", summary="Реестр модулей отеля")
def get_modules(request: HttpRequest, hotel_id: str):
    hotel = _get_hotel(hotel_id)
    return {"tariff": hotel.tariff, "modules": list_modules(hotel)}


@router.put("/hotels/{hotel_id}/modules", summary="Настроить реестр модулей")
def put_modules(request: HttpRequest, hotel_id: str, payload: ModulesIn):
    hotel = _get_hotel(hotel_id)
    if payload.tariff is not None:
        hotel.tariff = payload.tariff
        hotel.save(update_fields=["tariff", "updated_at"])
    modules = set_modules(hotel, [entry.dict() for entry in payload.modules])
    _audit(request, hotel, "platform.hotel.modules_set", {"count": len(modules)})
    return {"tariff": hotel.tariff, "modules": modules}


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
