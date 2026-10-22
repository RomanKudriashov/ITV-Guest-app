"""
Отель глазами платформы: заведение, профиль, модули, офбординг, вход в отель.

Проверки прав намеренно остались ЗДЕСЬ, во вьюхе, а не уехали в сервис: партия
переносит раскладку, а не решает, кому что можно. Где право проверялось во
вьюхе — оно там же и осталось, строка в строку.
"""

from __future__ import annotations


from django.http import HttpRequest

from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.core.errors import PermissionDenied, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import Hotel
from apps.hotels.module_registry import list_modules
from apps.hotels.schemas.platform import (
    DisableIn,
    AdminEmailIn,
    AdminIn,
    EnterHotelIn,
    HotelCreateIn,
    HotelPatchIn,
    ModuleSwitchIn,
    OffboardIn,
    PurgeIn,
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
    return console.list_briefs(limit=limit, user=request.user)


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


def _as_translations(value, language: str) -> dict:
    """Переводимое поле словарём: старые строки (до порчи) — под язык отеля."""
    if isinstance(value, dict):
        return dict(value)
    return {language: value} if value else {}


@router.patch("/hotels/{hotel_id}", summary="Изменить профиль отеля")
@requires(WRITE)
def patch_hotel(request: HttpRequest, hotel_id: str, payload: HotelPatchIn):
    """
    Правка профиля — `profile_edit.apply` (партия 62-C): переводы по языкам,
    только изменённое, опасное — через 409 `needs_confirmation`, поддомен и
    свой домен — владелец, журнал «было → стало».
    """
    from apps.hotels.services.platform import profile_edit

    hotel = console.get_hotel(hotel_id)
    profile_edit.apply(hotel, payload.dict(exclude_unset=True), user=request.user, ip=request.META.get("REMOTE_ADDR"))
    return console.profile(console.get_hotel(hotel_id))


@router.post("/hotels/{hotel_id}/disable", summary="Отключить отель (причина обязательна)")
@requires(WRITE)
def disable_hotel(request: HttpRequest, hotel_id: str, payload: DisableIn):
    from apps.hotels.services.platform import activation

    hotel = console.get_hotel(hotel_id)
    activation.disable(
        hotel, reason=payload.reason, enable_on=payload.enable_on, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR")
    )
    return console.profile(hotel)


@router.post("/hotels/{hotel_id}/enable", summary="Включить отель")
@requires(WRITE)
def enable_hotel(request: HttpRequest, hotel_id: str):
    from apps.hotels.services.platform import activation

    hotel = console.get_hotel(hotel_id)
    activation.enable(hotel, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"))
    return console.profile(hotel)


@router.delete("/hotels/{hotel_id}/aliases/{old}", summary="Снять перенаправление со старого поддомена")
@requires(OWNER)
def remove_alias(request: HttpRequest, hotel_id: str, old: str):
    from apps.hotels.services.platform import profile_edit

    hotel = console.get_hotel(hotel_id)
    profile_edit.remove_alias(hotel, old, user=request.user, ip=request.META.get("REMOTE_ADDR"))
    return console.profile(hotel)


@router.get("/hotels/{hotel_id}/domain-check", summary="Указывает ли свой домен на стенд")
@requires(READ)
def domain_check(request: HttpRequest, hotel_id: str, domain: str = ""):
    from apps.hotels.services.platform import profile_edit

    console.get_hotel(hotel_id)
    return profile_edit.check_domain(domain)


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
    # Запись в журнале одна — `impersonation.started` (партия 62-D): раньше
    # рядом ложилась вторая, `platform.hotel.entered`, о том же входе.
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
        # Панель отеля переехала в `/admin` на его же адресе: у отеля
        # своя админка, наша консоль на этот хост не пускается вовсе.
        "cms_url": hotel.public_guest_url("/admin"),
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
    sort: str = "",
    dir: str = "",
):
    """Кто сейчас внутри отелей: без списка отзывать нечего выбирать."""
    from apps.hotels.services.platform.console import active_impersonations

    return active_impersonations(
        search=search, state=state, limit=limit, offset=offset, sort=sort, direction=dir, user=request.user
    )


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


# --- Активность ---------------------------------------------------------------


@router.get("/hotels/{hotel_id}/activity", summary="Активность и журнал отеля")
@requires(READ)
def hotel_activity(request: HttpRequest, hotel_id: str, limit: int = 50):
    from apps.hotels.services.platform.usage import activity_for

    return activity_for(console.get_hotel(hotel_id), limit=limit)


# --- Модули отеля (партия 62-E1: без тарифов, по одному) -----------------------


@router.get("/hotels/{hotel_id}/modules", summary="Модули отеля")
@requires(READ)
def get_modules(request: HttpRequest, hotel_id: str):
    return {"modules": list_modules(console.get_hotel(hotel_id))}


@router.put("/hotels/{hotel_id}/modules/{code}", summary="Включить или выключить один модуль")
@requires(WRITE)
def put_module(request: HttpRequest, hotel_id: str, code: str, payload: ModuleSwitchIn):
    """
    ОДИН модуль — другие не трогаются. Заготовку включить нельзя: 409
    `module_in_development`; выключить можно. Журнал — «был → стал» (формат
    62-D); готовность и меню CMS отеля пересчитываются от правки строки модуля.
    """
    from apps.hotels.module_registry import set_module

    hotel = console.get_hotel(hotel_id)
    before, after = set_module(hotel, code, payload.enabled)
    if before != after:
        console.audit_hotel(
            hotel,
            "platform.hotel.modules_set",
            actor_id=request.user.pk,
            ip=request.META.get("REMOTE_ADDR"),
            payload={"module": code, "from": before, "to": after},
        )
    return {"modules": list_modules(hotel)}
