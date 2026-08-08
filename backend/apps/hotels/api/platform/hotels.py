"""
Отель глазами платформы: заведение, профиль, модули, офбординг, вход в отель.

Проверки прав намеренно остались ЗДЕСЬ, во вьюхе, а не уехали в сервис: партия
переносит раскладку, а не решает, кому что можно. Где право проверялось во
вьюхе — оно там же и осталось, строка в строку.
"""

from __future__ import annotations

from datetime import timedelta

from django.http import HttpRequest
from django.utils import timezone
from ninja import Router

from apps.core.context import tenant_context
from apps.core.errors import PermissionDenied, ValidationError
from apps.hotels.models import Hotel
from apps.hotels.module_registry import list_modules, set_modules
from apps.hotels.schemas.platform import (
    AdminIn,
    EnterHotelIn,
    HotelCreateIn,
    HotelPatchIn,
    ModulesIn,
    OffboardIn,
    PurgeIn,
    TariffIn,
)
from apps.hotels.services.platform import console
from apps.hotels.services.provisioning import provision_hotel, set_hotel_admin

router = Router(tags=["platform"])


# ВНИМАНИЕ: список и создание — ОДИН путь, и объявлены они обязаны быть в одном
# роутере. Разнести их по файлам значит получить два url-паттерна на «/hotels»:
# Django возьмёт первый и ответит 405 на метод, которого в нём нет.
@router.get("/hotels", summary="Список отелей")
def list_hotels(request: HttpRequest):
    return console.list_briefs()


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

    console.audit_hotel(
        result.hotel,
        "platform.hotel.created",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"subdomain": result.hotel.subdomain, "template": payload.template or "", "services": applied},
    )
    return 201, {
        "template": payload.template,
        "services": applied,
        "hotel": console.profile(result.hotel),
        "admin": {"email": result.admin.email, "password": result.admin_password},
    }


@router.get("/hotels/{hotel_id}", summary="Профиль отеля")
def get_hotel(request: HttpRequest, hotel_id: str):
    return console.profile(console.get_hotel(hotel_id))


@router.patch("/hotels/{hotel_id}", summary="Изменить профиль отеля")
def patch_hotel(request: HttpRequest, hotel_id: str, payload: HotelPatchIn):
    hotel = console.get_hotel(hotel_id)
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
        console.replace_languages(hotel, data["languages"])

    ip = request.META.get("REMOTE_ADDR")
    if fields or "languages" in data:
        console.audit_hotel(hotel, "platform.hotel.updated", actor_id=request.user.pk, ip=ip, payload={"fields": fields})
    if activation_change:
        console.audit_hotel(hotel, f"platform.hotel.{activation_change}", actor_id=request.user.pk, ip=ip)

    return console.profile(hotel)


@router.post("/hotels/{hotel_id}/admins", summary="Завести/сбросить hotel-admin")
def set_admin(request: HttpRequest, hotel_id: str, payload: AdminIn):
    hotel = console.get_hotel(hotel_id)
    user, password = set_hotel_admin(hotel, email=payload.email, password=payload.password)
    console.audit_hotel(
        hotel,
        "platform.hotel.admin_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"email": user.email},
    )
    return {"email": user.email, "password": password}


# --- Экспорт и офбординг (152-ФЗ) ------------------------------------------


@router.get("/hotels/{hotel_id}/export", summary="Выгрузить данные отеля")
def export_hotel_data(request: HttpRequest, hotel_id: str):
    from django.http import HttpResponse

    from apps.hotels.services.offboarding import export_json

    hotel = console.get_hotel(hotel_id)
    body = export_json(hotel)
    console.audit_hotel(
        hotel,
        "platform.hotel.exported",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"bytes": len(body)},
    )
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

    hotel = console.get_hotel(hotel_id)
    ip = request.META.get("REMOTE_ADDR")
    if payload.cancel:
        unmark(hotel)
        console.audit_hotel(hotel, "platform.hotel.offboard_cancelled", actor_id=request.user.pk, ip=ip)
        return {"marked": None}

    state = mark_for_offboarding(hotel, reason=payload.reason or "", actor_id=request.user.pk)
    console.audit_hotel(
        hotel, "platform.hotel.offboard_marked", actor_id=request.user.pk, ip=ip, payload={"reason": state["reason"]}
    )
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
    from apps.hotels.services.offboarding import mark_for_offboarding, purge_hotel

    if not can_manage_tariff(request.user):
        raise PermissionDenied("Удаление отеля проводит только владелец платформы")

    hotel = console.get_hotel(hotel_id)
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

    console.audit_platform(
        "platform.hotel.deleted",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"subdomain": hotel.subdomain, "origin": hotel.origin, "removed": result["removed"]},
    )
    console.delete_hotel_row(hotel)
    return {"deleted": True, "subdomain": hotel.subdomain, "removed": result["removed"]}


@router.post("/hotels/{hotel_id}/purge", summary="Необратимо стереть данные отеля")
def purge_hotel_data(request: HttpRequest, hotel_id: str, payload: PurgeIn):
    from apps.accounts.platform_access import can_manage_tariff
    from apps.hotels.services.offboarding import purge_hotel

    if not can_manage_tariff(request.user):
        raise PermissionDenied("Удаление данных проводит только владелец платформы")

    hotel = console.get_hotel(hotel_id)
    result = purge_hotel(hotel, confirm_subdomain=payload.confirm_subdomain, actor_id=request.user.pk)
    console.audit_hotel(
        hotel, "platform.hotel.purged", actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"), payload=result
    )
    return result


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

    hotel = console.get_hotel(hotel_id)
    reason = (payload.reason or "").strip()
    if not reason:
        # Причина обязательна: журнал без причины отвечает «кто и когда», но не
        # «зачем», а разбирают инциденты именно по «зачем».
        raise ValidationError("Укажите причину входа", field="reason")

    target = console.find_hotel_admin(hotel)
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
    console.audit_hotel(
        hotel,
        "platform.hotel.entered",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"reason": reason, "ttl_minutes": ttl},
    )
    return {
        "access": result["access"],
        "expires_at": result["expires_at"].isoformat(),
        "ttl_minutes": ttl,
        "as_user": target.email,
        "cms_url": hotel.public_guest_url("/cms"),
        "subdomain": hotel.subdomain,
    }


# --- Использование против лимитов, активность, тариф -----------------------


@router.get("/hotels/{hotel_id}/usage", summary="Использование против лимитов тарифа")
def hotel_usage(request: HttpRequest, hotel_id: str):
    from apps.hotels.services.platform.usage import usage_for

    return usage_for(console.get_hotel(hotel_id))


@router.get("/hotels/{hotel_id}/activity", summary="Активность и журнал отеля")
def hotel_activity(request: HttpRequest, hotel_id: str, limit: int = 50):
    from apps.hotels.services.platform.usage import activity_for

    return activity_for(console.get_hotel(hotel_id), limit=limit)


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

    hotel = console.get_hotel(hotel_id)
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
    console.audit_hotel(
        hotel,
        "platform.hotel.tariff_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"tariff": hotel.tariff, "trial_ends_at": str(hotel.trial_ends_at or "")},
    )
    return {"ok": True, "warnings": warnings, "profile": console.profile(hotel)}


# --- Реестр модулей --------------------------------------------------------
# Данные + API (R1). Управляющий UI — R6, гейтинг CMS-навигации — R4.
# Контракт — docs/module-registry-api-contract.md.


@router.get("/hotels/{hotel_id}/modules", summary="Реестр модулей отеля")
def get_modules(request: HttpRequest, hotel_id: str):
    hotel = console.get_hotel(hotel_id)
    return {"tariff": hotel.tariff, "modules": list_modules(hotel)}


@router.put("/hotels/{hotel_id}/modules", summary="Настроить реестр модулей")
def put_modules(request: HttpRequest, hotel_id: str, payload: ModulesIn):
    hotel = console.get_hotel(hotel_id)
    if payload.tariff is not None:
        hotel.tariff = payload.tariff
        hotel.save(update_fields=["tariff", "updated_at"])
    modules = set_modules(hotel, [entry.dict() for entry in payload.modules])
    console.audit_hotel(
        hotel,
        "platform.hotel.modules_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"count": len(modules)},
    )
    return {"tariff": hotel.tariff, "modules": modules}
