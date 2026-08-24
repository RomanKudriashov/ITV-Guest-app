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

from apps.core.context import tenant_context
from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.core.errors import PermissionDenied, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import Hotel
from apps.hotels.module_registry import list_modules, set_modules
from apps.hotels.schemas.platform import (
    AdminEmailIn,
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
from apps.hotels.services.provisioning import (
    change_hotel_admin_email,
    provision_hotel,
    set_hotel_admin,
)

router = PlatformRouter(tags=["platform"])


# ВНИМАНИЕ: список и создание — ОДИН путь, и объявлены они обязаны быть в одном
# роутере. Разнести их по файлам значит получить два url-паттерна на «/hotels»:
# Django возьмёт первый и ответит 405 на метод, которого в нём нет.
@router.get("/hotels", summary="Список отелей")
@requires(READ)
def list_hotels(request: HttpRequest, limit: int = 100):
    return console.list_briefs(limit=limit)


@router.post("/hotels", response={201: dict}, summary="Создать отель")
@requires(WRITE)
def create_hotel(request: HttpRequest, payload: HotelCreateIn):
    """
    Пароль заведённого администратора уходит ему письмом, а не в ответ.

    Вся операция — одна транзакция вместе с отправкой: не ушло письмо —
    отеля не появилось. Иначе оператор получал бы отель с администратором,
    пароля которого не знает никто.
    """
    from django.db import transaction

    from apps.hotels.services.admin_credentials import send_admin_password

    with transaction.atomic():
        result = provision_hotel(
            subdomain=payload.subdomain,
            name=payload.name,
            admin_email=payload.admin_email,
            timezone=payload.timezone,
            currency=payload.currency,
            languages=payload.languages,
            preset=payload.preset,
            exist_ok=False,
            origin=payload.origin,
        )
        applied: list[str] = []
        if payload.template:
            from apps.hotels.services.onboarding import apply_template, ensure_seed, get_template

            ensure_seed()
            template = get_template(payload.template)
            applied = [service.code for service in apply_template(result.hotel, template)]

        delivery = send_admin_password(
            result.hotel,
            email=result.admin.email,
            password=result.admin_password,
            is_new=True,
        )

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
        "admin": {"email": result.admin.email, **delivery},
    }


@router.get("/hotels/{hotel_id}", summary="Профиль отеля")
@requires(READ)
def get_hotel(request: HttpRequest, hotel_id: str):
    return console.profile(console.get_hotel(hotel_id))


@router.patch("/hotels/{hotel_id}", summary="Изменить профиль отеля")
@requires(WRITE)
def patch_hotel(request: HttpRequest, hotel_id: str, payload: HotelPatchIn):
    hotel = console.get_hotel(hotel_id)
    data = payload.dict(exclude_unset=True)
    fields: list[str] = []
    # СТАРЫЕ ЗНАЧЕНИЯ СНИМАЕМ ДО ЗАПИСИ. Журнал, в котором сказано только
    # «изменено поле currency», через месяц не отвечает на вопрос, ради
    # которого его читают: с чего на что поменяли и было ли это ошибкой.
    changes: dict[str, dict] = {}
    for attr in ("name", "timezone", "currency", "currency_minor_units"):
        if attr in data and data[attr] is not None and getattr(hotel, attr) != data[attr]:
            changes[attr] = {"from": getattr(hotel, attr), "to": data[attr]}
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
        language_change = console.replace_languages(hotel, data["languages"])
        if language_change:
            changes["languages"] = language_change

    ip = request.META.get("REMOTE_ADDR")
    if changes:
        console.audit_hotel(
            hotel,
            "platform.hotel.updated",
            actor_id=request.user.pk,
            ip=ip,
            # `fields` оставлен ради читателей, которые уже на него смотрят;
            # `changes` — то, ради чего журнал вообще ведут.
            payload={"fields": sorted(changes), "changes": changes},
        )
    if activation_change:
        console.audit_hotel(hotel, f"platform.hotel.{activation_change}", actor_id=request.user.pk, ip=ip)

    return console.profile(hotel)


@router.get("/hotels/{hotel_id}/admins", summary="Администраторы отеля")
@requires(READ)
def list_admins(request: HttpRequest, hotel_id: str):
    """
    Кто сегодня админ отеля. Списка не существовало нигде — и опечатка в адресе
    при заведении молча добавляла ВТОРОГО полноправного администратора.
    """
    from apps.hotels.services.provisioning import list_hotel_admins

    return {"admins": list_hotel_admins(console.get_hotel(hotel_id))}


@router.post("/hotels/{hotel_id}/admins", summary="Завести/сбросить hotel-admin")
@requires(WRITE)
def set_admin(request: HttpRequest, hotel_id: str, payload: AdminIn):
    """
    Пароль уходит АДМИНИСТРАТОРУ письмом, оператору — только факт отправки.

    Возврат пароля в теле был готовым захватом тенанта: вошедший в консоль
    получал полный доступ в CMS любого отеля, а сам отель об этом не узнавал.
    Теперь оператор видит адрес, на который ушло письмо, и больше ничего.

    Почта не работает — операция ОТКАЗЫВАЕТ, и пароль остаётся прежним
    (см. services/admin_credentials): «отправлено» при неушедшем письме
    заперло бы отель.
    """
    hotel = console.get_hotel(hotel_id)
    # ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ: второй админ бывает нужен (передача дел,
    # два управляющих). Но чаще это опечатка в адресе — и раньше она молча
    # заводила второго полноправного администратора, а увидеть это было негде.
    from apps.hotels.services.provisioning import list_hotel_admins

    existing = [a for a in list_hotel_admins(hotel) if a["is_active"]]
    already = [a["email"] for a in existing if a["email"] != payload.email.strip().lower()]

    user, delivery = set_hotel_admin(hotel, email=payload.email, password=payload.password)
    console.audit_hotel(
        hotel,
        "platform.hotel.admin_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        # В журнале — адрес и факт отправки. Пароля здесь нет и не будет:
        # журнал читают шире, чем ответ на запрос.
        payload={"email": user.email, "delivered_to": delivery["delivered_to"]},
    )
    return {"email": user.email, "existing_admins": already, **delivery}


@router.put("/hotels/{hotel_id}/admins/email", summary="Сменить адрес администратора отеля")
@requires(OWNER)
def change_admin_email(request: HttpRequest, hotel_id: str, payload: AdminEmailIn):
    """
    Выход из положения «отель потерял и почту тоже».

    Пароль теперь уходит только на адрес администратора — значит недоступный
    адрес запирает отель насмерть. Эта ручка меняет адрес, НИЧЕГО на него не
    отправляя: отправлять было бы некуда, в том и беда. После смены оператор
    делает обычный сброс, и пароль уезжает уже на новый адрес.

    Право владельца, а не поддержки: подмена адреса — это и есть способ
    увести отель, и он не должен быть рутинной операцией.
    """
    hotel = console.get_hotel(hotel_id)
    user = change_hotel_admin_email(
        hotel, current_email=payload.current_email, new_email=payload.new_email
    )

    console.audit_hotel(
        hotel,
        "platform.hotel.admin_email_changed",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"from": (payload.current_email or "").strip().lower(), "to": user.email},
    )
    return {"email": user.email, "previous_email": (payload.current_email or "").strip().lower()}


# --- Экспорт и офбординг (152-ФЗ) ------------------------------------------


# ВНИМАНИЕ: объявляется ПОСЛЕ `admins/email`. Шаблон `{user_id}` совпадает и с
# литералом `email`, и роутер берёт ПЕРВЫЙ подошедший: объявленный выше, он
# перехватывал бы смену адреса и отвечал 405 на её метод. Тот же капкан, что
# описан выше про список и создание отелей.
@router.delete("/hotels/{hotel_id}/admins/{user_id}", summary="Убрать администратора отеля")
@requires(OWNER)
def remove_admin(request: HttpRequest, hotel_id: str, user_id: str):
    """
    Снимает право админа. Последнего убрать нельзя — отель остался бы без
    доступа к своей CMS.

    Право OWNER, а не WRITE: это отъём доступа у клиента, и цена ошибки здесь
    выше, чем у заведения нового администратора.
    """
    from apps.hotels.services.provisioning import remove_hotel_admin

    hotel = console.get_hotel(hotel_id)
    removed = remove_hotel_admin(hotel, user_id)
    console.audit_hotel(
        hotel,
        "platform.hotel.admin_removed",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload=removed,
    )
    return {"ok": True, **removed}


@router.get("/hotels/{hotel_id}/export", summary="Выгрузить данные отеля")
@requires(WRITE)
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
@requires(OWNER)
def offboard_hotel(request: HttpRequest, hotel_id: str, payload: OffboardIn):
    from apps.hotels.services.offboarding import mark_for_offboarding, unmark

    # Офбординг — договорное решение, а не операционное: его принимает владелец.

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


@router.delete("/hotels/{hotel_id}", summary="Убрать отель из реестра")
@requires(OWNER)
def delete_hotel(request: HttpRequest, hotel_id: str, confirm_subdomain: str = ""):
    """
    Убрать отель из реестра: данные стереть, строку скрыть, имя освободить.

    Названо так, как сделано. «Полное удаление вместе со строкой» было
    обещанием больше сделанного: строка остаётся — мягко удалённой, — вместе
    с журналом, который тоже лишь скрывается. Необратимо здесь стираются
    ДАННЫЕ отеля, и делает это тот же офбординг.

    Два разных сценария и потому две разные операции. Живой отель уходит через
    офбординг: его данные стираются, но он остаётся в реестре видимым. А вот
    отель, заведённый автотестом или по ошибке, не должен оставаться в
    реестре памятником — ему там нечего помнить.

    Поддомен после удаления СВОБОДЕН: имя старой строки паркуется
    (`crystal-deleted-20260814-a1b2c3`), прежнее сохраняется отдельным полем.
    Запрос на старое имя перестаёт находить отель сразу — резолвер ищет среди
    живых строк и никакого кэша не держит.

    Защита — не галочка, а ввод поддомена: имя удаляемого набирают, только
    посмотрев на него. Для отелей с признаком `test` подтверждение не нужно:
    их и завели затем, чтобы удалить.
    """
    from apps.hotels.services.offboarding import mark_for_offboarding, purge_hotel

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
@requires(OWNER)
def purge_hotel_data(request: HttpRequest, hotel_id: str, payload: PurgeIn):
    from apps.hotels.services.offboarding import purge_hotel

    hotel = console.get_hotel(hotel_id)
    result = purge_hotel(hotel, confirm_subdomain=payload.confirm_subdomain, actor_id=request.user.pk)
    console.audit_hotel(
        hotel, "platform.hotel.purged", actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"), payload=result
    )
    return result


# --- Вход в отель ----------------------------------------------------------


@router.post("/hotels/{hotel_id}/enter", summary="Войти в отель от лица платформы")
@requires(WRITE)
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
    from apps.accounts.services import start_impersonation

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
        # ОДНОРАЗОВЫЙ КОД, а не токен. Консоль передаёт его в хэш-фрагменте
        # адреса, который браузер вообще не отправляет на сервер: ни в логах
        # прокси, ни в `Referer` его не будет. CMS меняет код на токен
        # запросом с телом и тут же вычищает фрагмент из истории.
        "code": result["code"],
        "code_expires_at": result["code_expires_at"].isoformat(),
        "grant_id": result["grant_id"],
        "expires_at": result["expires_at"].isoformat(),
        "ttl_minutes": ttl,
        "as_user": target.email,
        "cms_url": hotel.public_guest_url("/cms"),
        "subdomain": hotel.subdomain,
    }


@router.get("/impersonations", summary="Активные сессии поддержки")
@requires(READ)
def list_impersonations(
    request: HttpRequest,
    search: str = "",
    state: str = "active",
    limit: int | None = None,
    offset: int = 0,
):
    """Кто сейчас внутри отелей: без списка отзывать нечего выбирать."""
    from apps.hotels.services.platform.console import active_impersonations

    return active_impersonations(search=search, state=state, limit=limit, offset=offset)


@router.post("/impersonations/{grant_id}/revoke", summary="Оборвать сессию поддержки")
@requires(WRITE)
def revoke_impersonation_session(request: HttpRequest, grant_id: str):
    """
    Оборвать может вошедший или владелец платформы (проверка в сервисе:
    «свой грант» знает он, а не право ручки).

    Администратор отеля — не может: он сессию видит баннером, но не рвёт.
    Иначе разбор инцидента блокируется изнутри разбираемого отеля.
    """
    from apps.accounts.services.services import revoke_impersonation
    from apps.core.errors import PermissionDenied as Denied

    try:
        grant = revoke_impersonation(grant_id, actor=request.user)
    except Exception as exc:  # AuthenticationFailed из сервиса
        raise Denied(str(exc), code="revoke_denied") from exc
    return {"grant_id": str(grant.pk), "revoked_at": grant.revoked_at.isoformat()}


# --- Использование против лимитов, активность, тариф -----------------------


@router.get("/hotels/{hotel_id}/usage", summary="Использование против лимитов тарифа")
@requires(READ)
def hotel_usage(request: HttpRequest, hotel_id: str):
    from apps.hotels.services.platform.usage import usage_for

    return usage_for(console.get_hotel(hotel_id))


@router.get("/hotels/{hotel_id}/activity", summary="Активность и журнал отеля")
@requires(READ)
def hotel_activity(request: HttpRequest, hotel_id: str, limit: int = 50):
    from apps.hotels.services.platform.usage import activity_for

    return activity_for(console.get_hotel(hotel_id), limit=limit)


@router.put("/hotels/{hotel_id}/tariff", summary="Записать тариф отеля")
@requires(OWNER)
def set_tariff(request: HttpRequest, hotel_id: str, payload: TariffIn):
    """
    Тариф — ЗАПИСЬ, а не операция с деньгами: здесь нет ни сумм, ни счетов, ни
    списаний. Шов под будущий биллинг: когда он появится, он будет читать эти
    даты, а не заводить свои.
    """
    from apps.hotels.services import tariffs as tariff_registry
    from apps.hotels.services.platform.usage import downgrade_warnings

    hotel = console.get_hotel(hotel_id)
    if payload.tariff not in tariff_registry.TARIFFS:
        raise ValidationError(f"Неизвестный тариф «{payload.tariff}»", field="tariff")

    warnings = downgrade_warnings(hotel, payload.tariff)
    # Понижение ниже использования НЕ запрещаем, но и не делаем молча: платформа
    # обязана знать, что у отеля станет больше сервисов, чем позволяет тариф.
    if warnings and not payload.acknowledge_downgrade:
        return {"ok": False, "warnings": warnings, "code": "downgrade_blocked"}

    # СМЕНА — ЭТО СМЕНА, а не любая запись. Сравниваем разрешённые коды: пустое
    # поле и «standard» — один и тот же тариф, и продлить отелю то, на чём он и
    # так сидит, не должно гасить ему модули, выданные сверх тарифа. Иначе
    # «записать тариф» превращается в разрушительное действие с безобидным
    # названием, и первым на нём подорвался общий стенд.
    changed = tariff_registry.get(hotel.tariff).code != tariff_registry.get(payload.tariff).code

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

    # ПЕРЕСЧЁТ РЕЕСТРА — здесь, а не «как-нибудь потом». До R6 смена тарифа не
    # трогала модули вообще: старые оставались включёнными и подписывались «по
    # тарифу», новые не включались, а предупреждение о даунгрейде было словами
    # без последствий. Намерения при этом не трогаем — пересчитываем следствие.
    from apps.hotels.module_registry import apply_tariff

    turned_off = apply_tariff(hotel) if changed else []

    console.audit_hotel(
        hotel,
        "platform.hotel.tariff_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={
            "tariff": hotel.tariff,
            "trial_ends_at": str(hotel.trial_ends_at or ""),
            # Погашенные модули — в журнал поимённо: «почему у отеля пропал
            # раздел» спрашивают через неделю, и ответ должен быть найден.
            "modules_turned_off": turned_off,
        },
    )
    return {
        "ok": True,
        "warnings": warnings,
        "modules_turned_off": turned_off,
        "profile": console.profile(hotel),
    }


# --- Реестр модулей --------------------------------------------------------
# Данные + API (R1). Управляющий UI — R6, гейтинг CMS-навигации — R4.
# Контракта у механизма нет: ссылка отсюда годами вела в несуществующий файл.
# Механизм описания заслуживает — выключенный модуль закрывает целый раздел CMS
# ответом `403 module_disabled`. Очередь: docs/api-contracts.md.


@router.get("/hotels/{hotel_id}/modules", summary="Реестр модулей отеля")
@requires(READ)
def get_modules(request: HttpRequest, hotel_id: str):
    hotel = console.get_hotel(hotel_id)
    return {"tariff": hotel.tariff, "modules": list_modules(hotel)}


@router.put("/hotels/{hotel_id}/modules", summary="Настроить реестр модулей")
@requires(WRITE)
def put_modules(request: HttpRequest, hotel_id: str, payload: ModulesIn):
    hotel = console.get_hotel(hotel_id)
    modules = set_modules(hotel, [entry.dict() for entry in payload.modules])
    console.audit_hotel(
        hotel,
        "platform.hotel.modules_set",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"count": len(modules)},
    )
    return {"tariff": hotel.tariff, "modules": modules}
