"""
Платформенная консоль: управление отелями. Контракт — docs/platform-api-contract.md.

Работает на базовом домене под PlatformAuth (scope: platform). Все изменяющие
действия пишутся в AuditLog. Создание отеля — через единую точку
apps/hotels/provisioning.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.http import HttpRequest
from django.utils import timezone
from ninja import Router
from apps.hotels.schemas.platform import (
    AdminIn,
    BulkActiveIn,
    DictionaryEntryIn,
    EnterHotelIn,
    HotelCreateIn,
    HotelPatchIn,
    ModulesIn,
    NodeIn,
    OffboardIn,
    PlatformLoginIn,
    PurgeIn,
    TariffIn,
    TeamInviteIn,
    TeamPatchIn,
    TemplateIn,
    TotpEnableIn,
)

from apps.catalog.models import Item
from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.core.errors import NotFoundError, PermissionDenied, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import ExecutionPoint, Hotel, HotelLanguage, Room
from apps.hotels.module_registry import list_modules, set_modules
from apps.hotels.services.provisioning import provision_hotel, set_hotel_admin

router = Router(tags=["platform"])


# --- Схемы -----------------------------------------------------------------




































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
        # Состояние офбординга отдаём ОТДЕЛЬНЫМ полем, а не сырыми settings:
        # settings отеля — свалка внутренних ключей, и выставлять её наружу
        # значит однажды показать в интерфейсе что-то, чего там быть не должно.
        "offboarding": _offboarding_state(hotel),
    }


def _offboarding_state(hotel: Hotel) -> dict | None:
    from apps.hotels.services.offboarding import offboarding_state

    return offboarding_state(hotel)


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


# --- Сводка ----------------------------------------------------------------


@router.get("/overview", summary="Сводка по платформе")
def overview(request: HttpRequest):
    from apps.hotels.services.platform.overview import build_overview

    return build_overview()


@router.get("/hotels", summary="Список отелей")
def list_hotels(request: HttpRequest):
    return [_brief(h) for h in Hotel.objects.order_by("-created_at")]


# --- Флот ------------------------------------------------------------------


@router.get("/fleet", summary="Реестр отелей: поиск, фильтры, сортировка, страницы")
def fleet(request: HttpRequest):
    from apps.hotels.services.platform.fleet import fleet as build_fleet

    return build_fleet(request.GET.dict())


@router.get("/fleet/export", summary="Выгрузка флота в CSV")
def fleet_export(request: HttpRequest):
    from django.http import HttpResponse

    from apps.hotels.services.platform.fleet import export_csv

    body = export_csv(request.GET.dict())
    _audit_platform(request, "platform.fleet.exported", payload={"bytes": len(body)})
    response = HttpResponse(body, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="fleet.csv"'
    return response


@router.post("/fleet/bulk", summary="Массово включить/выключить отели")
def fleet_bulk(request: HttpRequest, payload: BulkActiveIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.platform.fleet import bulk_set_active

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не меняет отели")

    changed = bulk_set_active(payload.hotel_ids, payload.is_active)
    action = "activated" if payload.is_active else "deactivated"
    for hotel in changed:
        _audit(request, hotel, f"platform.hotel.{action}", {"bulk": True})
    _audit_platform(
        request,
        "platform.fleet.bulk",
        payload={"action": action, "requested": len(payload.hotel_ids), "changed": len(changed)},
    )
    # Возвращаем СМЕНИВШИЕСЯ, а не запрошенные: «выключено 3 из 5» — честный
    # ответ, «выключено 5» при двух уже выключенных — нет.
    return {"changed": len(changed), "requested": len(payload.hotel_ids)}


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
        origin=payload.origin,
    )
    applied: list[str] = []
    if payload.template:
        from apps.hotels.services.onboarding import apply_template, ensure_seed, get_template

        ensure_seed()
        template = get_template(payload.template)
        applied = [service.code for service in apply_template(result.hotel, template)]

    _audit(
        request,
        result.hotel,
        "platform.hotel.created",
        {"subdomain": result.hotel.subdomain, "template": payload.template or "", "services": applied},
    )
    return 201, {
        "template": payload.template,
        "services": applied,
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


# --- Экспорт и офбординг (152-ФЗ) ------------------------------------------


@router.get("/hotels/{hotel_id}/export", summary="Выгрузить данные отеля")
def export_hotel_data(request: HttpRequest, hotel_id: str):
    from django.http import HttpResponse

    from apps.hotels.services.offboarding import export_json

    hotel = _get_hotel(hotel_id)
    body = export_json(hotel)
    _audit(request, hotel, "platform.hotel.exported", {"bytes": len(body)})
    response = HttpResponse(body, content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{hotel.subdomain}-export.json"'
    return response


@router.post("/hotels/{hotel_id}/offboard", summary="Пометить отель к офбордингу")
def offboard_hotel(request: HttpRequest, hotel_id: str, payload: OffboardIn):
    from apps.accounts.platform_access import can_manage_tariff
    from apps.hotels.services.offboarding import mark_for_offboarding, unmark

    # Офбординг — договорное решение, а не операционное: его принимает владелец.
    if not can_manage_tariff(request.user):
        raise PermissionDenied("Офбординг проводит только владелец платформы")

    hotel = _get_hotel(hotel_id)
    if payload.cancel:
        unmark(hotel)
        _audit(request, hotel, "platform.hotel.offboard_cancelled")
        return {"marked": None}

    state = mark_for_offboarding(hotel, reason=payload.reason or "", actor_id=request.user.pk)
    _audit(request, hotel, "platform.hotel.offboard_marked", {"reason": state["reason"]})
    return {"marked": state}


@router.delete("/hotels/{hotel_id}", summary="Удалить отель целиком")
def delete_hotel(request: HttpRequest, hotel_id: str, confirm_subdomain: str = ""):
    """
    Полное удаление отеля вместе со строкой — то, чего офбординг НЕ делает.

    Два разных сценария и потому две разные операции. Живой отель уходит через
    офбординг: его данные стираются, но строка остаётся, потому что платформа
    обязана уметь ответить, что он был. А вот отель, заведённый автотестом или
    по ошибке, не должен оставаться в реестре памятником — ему там нечего
    помнить.

    Защита — не галочка, а ввод поддомена: имя удаляемого набирают, только
    посмотрев на него. Для отелей с признаком `test` подтверждение не нужно:
    их и завели затем, чтобы удалить.
    """
    from apps.accounts.platform_access import can_manage_tariff
    from apps.core.context import platform_scope
    from apps.hotels.services.offboarding import mark_for_offboarding, purge_hotel

    if not can_manage_tariff(request.user):
        raise PermissionDenied("Удаление отеля проводит только владелец платформы")

    hotel = _get_hotel(hotel_id)
    is_test = hotel.origin == Hotel.Origin.TEST
    if not is_test and (confirm_subdomain or "").strip().lower() != hotel.subdomain:
        raise ValidationError(
            "Поддомен введён неверно — отель не удалён",
            field="confirm_subdomain",
            code="confirm_mismatch",
        )

    # Данные стираем тем же кодом, что и офбординг: два способа удалять одно и
    # то же однажды разъедутся, и один из них забудет новую таблицу.
    if not hotel.settings.get("offboarding"):
        mark_for_offboarding(hotel, reason="удаление отеля", actor_id=request.user.pk)
    result = purge_hotel(hotel, confirm_subdomain=hotel.subdomain, actor_id=request.user.pk)

    _audit_platform(
        request,
        "platform.hotel.deleted",
        payload={"subdomain": hotel.subdomain, "origin": hotel.origin, "removed": result["removed"]},
    )
    # Журнал отеля уходит вместе с ним: он тенантный и без отеля не читается.
    with platform_scope():
        AuditLog.all_objects.using("platform").filter(hotel_id=hotel.pk).delete()
    Hotel.objects.filter(pk=hotel.pk).delete()
    return {"deleted": True, "subdomain": hotel.subdomain, "removed": result["removed"]}


@router.post("/hotels/{hotel_id}/purge", summary="Необратимо стереть данные отеля")
def purge_hotel_data(request: HttpRequest, hotel_id: str, payload: PurgeIn):
    from apps.accounts.platform_access import can_manage_tariff
    from apps.hotels.services.offboarding import purge_hotel

    if not can_manage_tariff(request.user):
        raise PermissionDenied("Удаление данных проводит только владелец платформы")

    hotel = _get_hotel(hotel_id)
    result = purge_hotel(hotel, confirm_subdomain=payload.confirm_subdomain, actor_id=request.user.pk)
    _audit(request, hotel, "platform.hotel.purged", result)
    return result


# --- Шаблоны онбординга и системные справочники ----------------------------


@router.get("/templates", summary="Шаблоны онбординга")
def list_onboarding_templates(request: HttpRequest):
    from apps.hotels.services.onboarding import ensure_seed, list_templates

    # Пустая база даёт владельцу платформы пустой экран и вопрос «а что бывает».
    ensure_seed()
    return list_templates()


@router.post("/templates", response={201: dict}, summary="Создать шаблон")
def create_template(request: HttpRequest, payload: TemplateIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.models import OnboardingTemplate
    from apps.hotels.services.onboarding import serialize_template

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не правит шаблоны")
    data = payload.dict(exclude_unset=True)
    code = (data.get("code") or "").strip().lower()
    if not code:
        raise ValidationError("Нужен код шаблона", field="code")
    if OnboardingTemplate.objects.filter(code=code).exists():
        raise ValidationError(f"Шаблон «{code}» уже есть", field="code")
    template = OnboardingTemplate.objects.create(**{**data, "code": code})
    _audit_platform(request, "platform.template.created", payload={"code": code})
    return 201, serialize_template(template)


@router.patch("/templates/{template_id}", summary="Изменить шаблон")
def patch_template(request: HttpRequest, template_id: str, payload: TemplateIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.models import OnboardingTemplate
    from apps.hotels.services.onboarding import serialize_template

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не правит шаблоны")
    template = OnboardingTemplate.objects.filter(pk=template_id).first()
    if template is None:
        raise NotFoundError("Шаблон не найден")
    data = payload.dict(exclude_unset=True)
    # Код шаблона не меняем: на него ссылаются журнал и внешние скрипты.
    data.pop("code", None)
    for field, value in data.items():
        setattr(template, field, value)
    template.save()
    _audit_platform(request, "platform.template.updated", payload={"code": template.code})
    return serialize_template(template)


@router.get("/dictionaries", summary="Системный справочник платформы")
def get_system_dictionary(request: HttpRequest, kind: str | None = None):
    from apps.hotels.services.onboarding import ensure_seed, list_dictionary

    ensure_seed()
    return list_dictionary(kind)


@router.put("/dictionaries", summary="Добавить/изменить запись справочника")
def put_system_dictionary(request: HttpRequest, payload: DictionaryEntryIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onboarding import upsert_dictionary_entry

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не правит справочники")
    entry = upsert_dictionary_entry(
        kind=payload.kind, code=payload.code, title=payload.title, is_active=payload.is_active
    )
    _audit_platform(request, "platform.dictionary.updated",
                    payload={"kind": entry.kind, "code": entry.code})
    return {
        "id": str(entry.pk), "kind": entry.kind, "code": entry.code,
        "title": entry.title, "is_active": entry.is_active, "sort_order": entry.sort_order,
    }


# --- Вход в отель ----------------------------------------------------------


@router.post("/hotels/{hotel_id}/enter", summary="Войти в отель от лица платформы")
def enter_hotel(request: HttpRequest, hotel_id: str, payload: EnterHotelIn):
    """
    Impersonation с таймером и записью в аудит.

    Смысл механизма — РАЗДЕЛИМОСТЬ: правка, сделанная поддержкой, обязана
    отличаться от правки самого отеля. Поэтому вход идёт не «под общим
    техническим пользователем», а под конкретным админом отеля, но с клеймом
    `imp` в токене и грантом в базе; каждое действие пишется в журнал отеля с
    пометкой, кто был настоящим актором.

    Срок жизни короткий и обязательный: доступ ко всем данным отеля не должен
    висеть открытым дольше, чем длится разбор обращения.
    """
    from apps.accounts.platform_access import can_write
    from apps.accounts.services import start_impersonation

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не входит в отели")

    hotel = _get_hotel(hotel_id)
    reason = (payload.reason or "").strip()
    if not reason:
        # Причина обязательна: журнал без причины отвечает «кто и когда», но не
        # «зачем», а разбирают инциденты именно по «зачем».
        raise ValidationError("Укажите причину входа", field="reason")

    with tenant_context(hotel):
        target = (
            User.objects.filter(is_hotel_admin=True, is_active=True).order_by("created_at").first()
        )
    if target is None:
        raise ValidationError(
            "У отеля нет активного администратора — сначала заведите его", field="hotel"
        )

    ttl = max(5, min(payload.ttl_minutes or 30, 120))
    # Грант и запись аудита принадлежат ОТЕЛЮ, и писать их надо в его контексте:
    # платформенный запрос идёт без тенанта, и RLS справедливо отвергает строку,
    # у которой hotel_id не совпадает с сессионной переменной. Это не помеха, а
    # ровно то поведение, ради которого политика и заведена.
    with tenant_context(hotel):
        result = start_impersonation(
            actor=request.user, target_user=target, reason=reason, ttl_minutes=ttl
        )
    _audit(request, hotel, "platform.hotel.entered", {"reason": reason, "ttl_minutes": ttl})
    return {
        "access": result["access"],
        "expires_at": result["expires_at"].isoformat(),
        "ttl_minutes": ttl,
        "as_user": target.email,
        "cms_url": hotel.public_guest_url("/cms"),
        "subdomain": hotel.subdomain,
    }


# --- Тарифная сетка --------------------------------------------------------


@router.get("/tariffs", summary="Сетка тарифов: что открывает и какие лимиты")
def list_tariffs(request: HttpRequest):
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


# --- Он-прем узлы ----------------------------------------------------------


@router.get("/nodes", summary="Реестр он-прем узлов по всем отелям")
def list_nodes(request: HttpRequest):
    from apps.hotels.services.onprem import all_nodes

    return all_nodes()


@router.post("/hotels/{hotel_id}/nodes", response={201: dict}, summary="Завести узел и выдать ключ")
def create_node(request: HttpRequest, hotel_id: str, payload: NodeIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import register_node

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не заводит узлы")
    hotel = _get_hotel(hotel_id)
    node, key = register_node(hotel, name=payload.name, purpose=payload.purpose)
    _audit(request, hotel, "platform.node.registered", {"node": node.name, "purpose": node.purpose})
    # Ключ показывается ОДИН раз: в базе лежит только его хэш.
    return 201, {"node": _node_row(node, hotel), "key": key}


@router.post("/nodes/{node_id}/revoke", summary="Отозвать ключ узла")
def revoke_node(request: HttpRequest, node_id: str):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import revoke_key

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не отзывает ключи")
    node, hotel = revoke_key(node_id)
    _audit(request, hotel, "platform.node.revoked", {"node": node.name})
    return _node_row(node, hotel)


@router.post("/nodes/{node_id}/reissue", summary="Перевыпустить ключ узла")
def reissue_node(request: HttpRequest, node_id: str):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import reissue_key

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не выдаёт ключи")
    node, hotel, key = reissue_key(node_id)
    _audit(request, hotel, "platform.node.reissued", {"node": node.name})
    return {"node": _node_row(node, hotel), "key": key}


def _node_row(node, hotel) -> dict[str, Any]:
    from apps.hotels.services.onprem import serialize_node

    return serialize_node(node, hotel)


# --- Команда платформы -----------------------------------------------------


@router.get("/team", summary="Команда платформы")
def list_team(request: HttpRequest):
    from apps.hotels.services.platform.team import list_members

    return list_members()


@router.post("/team", response={201: dict}, summary="Пригласить в команду платформы")
def invite_member(request: HttpRequest, payload: TeamInviteIn):
    from apps.accounts.platform_access import can_manage_team
    from apps.hotels.services.platform.team import invite

    if not can_manage_team(request.user):
        raise PermissionDenied("Команду платформы ведёт только владелец")
    member, password = invite(email=payload.email, role=payload.role, full_name=payload.full_name)
    _audit_platform(request, "platform.team.invited", payload={"email": member.email, "role": member.platform_role})
    return 201, {"member": _member(member), "password": password}


@router.patch("/team/{user_id}", summary="Сменить роль или отключить участника")
def patch_member(request: HttpRequest, user_id: str, payload: TeamPatchIn):
    from apps.accounts.platform_access import can_manage_team
    from apps.hotels.services.platform.team import update_member

    if not can_manage_team(request.user):
        raise PermissionDenied("Команду платформы ведёт только владелец")
    member = update_member(
        user_id,
        role=payload.role,
        is_active=payload.is_active,
        actor_id=request.user.pk,
    )
    _audit_platform(request, "platform.team.updated",
                    payload={"email": member.email, "role": member.platform_role, "active": member.is_active})
    return _member(member)


def _member(user: User) -> dict[str, Any]:
    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.platform_role,
        "is_active": user.is_active,
        "totp_enabled": user.totp_enabled,
    }


# --- Аудит платформы -------------------------------------------------------


@router.get("/audit", summary="Журнал действий платформы")
def platform_audit(request: HttpRequest, limit: int = 100):
    from apps.hotels.services.platform.team import audit_feed

    return audit_feed(limit=limit)


# --- Использование против лимитов, активность, тариф -----------------------


@router.get("/hotels/{hotel_id}/usage", summary="Использование против лимитов тарифа")
def hotel_usage(request: HttpRequest, hotel_id: str):
    from apps.hotels.services.platform.usage import usage_for

    return usage_for(_get_hotel(hotel_id))


@router.get("/hotels/{hotel_id}/activity", summary="Активность и журнал отеля")
def hotel_activity(request: HttpRequest, hotel_id: str, limit: int = 50):
    from apps.hotels.services.platform.usage import activity_for

    return activity_for(_get_hotel(hotel_id), limit=limit)


@router.put("/hotels/{hotel_id}/tariff", summary="Записать тариф отеля")
def set_tariff(request: HttpRequest, hotel_id: str, payload: TariffIn):
    """
    Тариф — ЗАПИСЬ, а не операция с деньгами: здесь нет ни сумм, ни счетов, ни
    списаний. Шов под будущий биллинг: когда он появится, он будет читать эти
    даты, а не заводить свои.
    """
    from apps.accounts.platform_access import can_manage_tariff
    from apps.hotels.services import tariffs as tariff_registry
    from apps.hotels.services.platform.usage import downgrade_warnings

    if not can_manage_tariff(request.user):
        raise PermissionDenied("Тариф меняет только владелец платформы")

    hotel = _get_hotel(hotel_id)
    if payload.tariff not in tariff_registry.TARIFFS:
        raise ValidationError(f"Неизвестный тариф «{payload.tariff}»", field="tariff")

    warnings = downgrade_warnings(hotel, payload.tariff)
    # Понижение ниже использования НЕ запрещаем, но и не делаем молча: платформа
    # обязана знать, что у отеля станет больше сервисов, чем позволяет тариф.
    if warnings and not payload.acknowledge_downgrade:
        return {"ok": False, "warnings": warnings, "code": "downgrade_blocked"}

    hotel.tariff = payload.tariff
    hotel.tariff_started_on = payload.started_on or timezone.localdate()
    tariff = tariff_registry.get(payload.tariff)
    if tariff.is_trial:
        hotel.trial_ends_at = payload.trial_ends_at or (
            hotel.tariff_started_on + timedelta(days=tariff.trial_days)
        )
    else:
        hotel.trial_ends_at = None
    hotel.save(update_fields=["tariff", "tariff_started_on", "trial_ends_at", "updated_at"])
    _audit(request, hotel, "platform.hotel.tariff_set",
           {"tariff": hotel.tariff, "trial_ends_at": str(hotel.trial_ends_at or "")})
    return {"ok": True, "warnings": warnings, "profile": _profile(hotel)}


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
