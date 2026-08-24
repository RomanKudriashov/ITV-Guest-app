"""
КОНФИГУРАЦИЯ УПРАВЛЕНИЯ НОМЕРОМ — РАБОТА ПЛАТФОРМЫ, А НЕ ОТЕЛЯ.

Импорт ПНР, конструктор экрана, план и публикация переехали сюда из CMS отеля.
Причина не в удобстве, а в том, ЧЬЯ это работа: услуга платная, оказываем её мы,
и администратор отеля не открывает Excel с картой каналов и не размечает зоны.

Два перекоса, которые этот переезд убирает.

ОТЕЛЮ БЫЛО ДАНО ЛИШНЕЕ. Администратор мог сдвинуть зоны, опубликовать
полупустой конструктор, удалить тип — испортить конфигурацию, за которую платит
нам. Злого умысла для этого не нужно, хватает любопытства.

НАМ НЕ БЫЛО ДАНО НИЧЕГО. Наш оператор настраивал чужой отель имперсонацией, то
есть под чужой учёткой, и в журнале это выглядело как действия администратора
отеля. На вопрос «кто сдвинул зону» ответа не было.

ПРАВА ЖИВУТ ТАМ, КУДА ПРИХОДИТ ЗАПРОС. Здесь это `PlatformRouter` с
`@requires(...)`: калитка на самом маршруте, а не проверка роли внутри чужой
авторизации. На этом мы уже обожглись — ручка уровня плана сначала стояла в
CMS с проверкой «ты платформенный админ» и оказалась недостижимой, потому что
под `/api/v1/cms` платформенный токен не пускают вовсе.

ЖУРНАЛ ПИШЕТСЯ КАК ПЛАТФОРМЕННЫЙ. `console.audit_hotel` ставит
`actor_type=platform` и id НАШЕГО оператора внутри тенант-контекста отеля: в
журнале отеля видно, что конфигурацию менял не его администратор.

Модуль отеля проверяется по-прежнему: без `room_control` оборудования у отеля
нет, и настраивать нечего.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import File
from ninja.files import UploadedFile

from apps.core.context import tenant_context
from apps.grms.schemas.cms import (
    BindingIn,
    CheckIn,
    ElementIn,
    OverrideIn,
    PlanCopyIn,
    PlanGeometryIn,
    PlanLevelIn,
    RollbackIn,
    ZoneIn,
)
from apps.grms.services import builder, plan_editor, publishing, roomcheck
from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform-grms"])

# Кадр плана — фотография или рендер комнаты: 12 МБ хватает даже для снимка с
# телефона без сжатия, а больше означает, что грузят не то.
MAX_PLAN_BYTES = 12 * 1024 * 1024

BASE = "/hotels/{hotel_id}/grms"


def _hotel(hotel_id: str):
    """
    Отель по id плюс проверка модуля.

    Модуль проверяется и здесь: без `room_control` у отеля нет оборудования, и
    настраивать нечего. Проверка стоит на КАЖДОЙ ручке, а не на экране консоли,
    — по той же причине, по которой она стоит на каждой ручке CMS.
    """
    from apps.hotels.models import HotelModule
    from apps.hotels.module_registry import enabled_module_codes
    from apps.grms.services.access import ModuleDisabled

    hotel = console.get_hotel(hotel_id)
    if HotelModule.Code.ROOM_CONTROL not in enabled_module_codes(hotel):
        raise ModuleDisabled("Модуль «Управление номером» не подключён")
    return hotel


def _audit(hotel, request: HttpRequest, action: str, **payload) -> None:
    """Действие платформы в журнале ОТЕЛЯ: видно, что менял не его админ."""
    console.audit_hotel(
        hotel,
        action,
        actor_id=getattr(request.auth, "pk", None),
        payload=payload,
    )


# --- Каталог и типы ---------------------------------------------------------


@router.get(f"{BASE}/catalog", summary="Каталог видов элементов")
@requires(READ)
def catalog(request: HttpRequest, hotel_id: str):
    from apps.grms.api.cms.catalog import get_catalog as cms_catalog

    # Каталог одинаков для всех отелей и никого не меняет — зовём тот же код.
    return cms_catalog(request)


@router.get(f"{BASE}/types", summary="Типы номеров с переменными")
@requires(READ)
def list_types(request: HttpRequest, hotel_id: str):
    return {"types": builder.list_types_with_variables(_hotel(hotel_id))}


@router.get(f"{BASE}/types/{{code}}/status", summary="Что опубликуется, а что скрыто")
@requires(READ)
def type_status(request: HttpRequest, hotel_id: str, code: str):
    return builder.type_status(_hotel(hotel_id), code)


# --- Импорт ПНР -------------------------------------------------------------


@router.post(f"{BASE}/import/preview", summary="Разобрать Excel ПНР (без сохранения)")
@requires(WRITE)
def import_preview(request: HttpRequest, hotel_id: str, file: UploadedFile = File(...)):
    from apps.grms.services import imports

    _hotel(hotel_id)
    return imports.preview(file.read(), filename=file.name or "pnr.xlsx")


@router.post(f"{BASE}/import/reconcile", summary="Сверить разобранное с живым iRidi")
@requires(WRITE)
def import_reconcile(request: HttpRequest, hotel_id: str, payload: dict):
    from apps.grms.services import imports

    hotel = _hotel(hotel_id)
    with tenant_context(hotel):
        return imports.reconcile(hotel, payload)


@router.post(f"{BASE}/import/confirm", summary="Сохранить подтверждённый импорт")
@requires(WRITE)
def import_confirm(request: HttpRequest, hotel_id: str, payload: dict):
    from apps.grms.services import imports

    hotel = _hotel(hotel_id)
    result = imports.confirm(hotel, payload)
    _audit(hotel, request, "grms.import_confirmed", types=result.get("types"))
    return result


# --- Конструктор ------------------------------------------------------------


@router.post(f"{BASE}/types/{{code}}/zones", summary="Добавить зону")
@requires(WRITE)
def add_zone(request: HttpRequest, hotel_id: str, code: str, payload: ZoneIn):
    hotel = _hotel(hotel_id)
    zone = builder.add_zone(
        hotel, room_type_code=code, code=payload.code,
        title=payload.title, sort_order=payload.sort_order,
    )
    _audit(hotel, request, "grms.zone_added", type=code, zone=zone.code)
    return {"code": zone.code}


@router.post(f"{BASE}/types/{{code}}/elements", summary="Поставить элемент каталога")
@requires(WRITE)
def add_element(request: HttpRequest, hotel_id: str, code: str, payload: ElementIn):
    hotel = _hotel(hotel_id)
    element = builder.add_element(
        hotel, room_type_code=code, kind=payload.kind, slug=payload.slug,
        zone_code=payload.zone_code, title=payload.title, sort_order=payload.sort_order,
    )
    _audit(hotel, request, "grms.element_added", type=code, slug=element.slug)
    return {"slug": element.slug, "kind": element.kind}


@router.post(f"{BASE}/types/{{code}}/bindings", summary="Связать возможность с переменной")
@requires(WRITE)
def bind(request: HttpRequest, hotel_id: str, code: str, payload: BindingIn):
    hotel = _hotel(hotel_id)
    binding = builder.bind(
        hotel, room_type_code=code, element_slug=payload.element_slug,
        capability=payload.capability, variable_key=payload.variable_key,
        trigger_value=payload.trigger_value,
    )
    return {"element": payload.element_slug, "capability": binding.capability}


@router.post(f"{BASE}/types/{{code}}/device-override", summary="Имя устройства для комнаты")
@requires(WRITE)
def device_override(request: HttpRequest, hotel_id: str, code: str, payload: OverrideIn):
    hotel = _hotel(hotel_id)
    builder.set_device_override(
        hotel, room_number=payload.room_number, device_name=payload.device_name
    )
    _audit(hotel, request, "grms.device_override", room=payload.room_number)
    return {"room": payload.room_number, "device": payload.device_name}


@router.post(f"{BASE}/types/{{code}}/plan-level", summary="Уровень плана типа")
@requires(WRITE)
def set_plan_level(request: HttpRequest, hotel_id: str, code: str, payload: PlanLevelIn):
    """Уровень — часть платной услуги; журнал пишет сервис внутри контекста."""
    hotel = _hotel(hotel_id)
    builder.set_plan_level(hotel, room_type_code=code, level=payload.level)
    return {"code": code, "plan_level": payload.level}


# --- План -------------------------------------------------------------------


@router.get(f"{BASE}/types/{{code}}/plan", summary="План типа: кадры, разметка")
@requires(READ)
def get_plan(request: HttpRequest, hotel_id: str, code: str):
    return plan_editor.payload(_hotel(hotel_id), code)


@router.put(f"{BASE}/types/{{code}}/plan", summary="Сохранить разметку плана")
@requires(WRITE)
def save_plan(request: HttpRequest, hotel_id: str, code: str, payload: PlanGeometryIn):
    hotel = _hotel(hotel_id)
    result = plan_editor.save_geometry(hotel, code, payload)
    _audit(hotel, request, "grms.plan_saved", type=code, zones=len(payload.zones))
    return result


@router.post(f"{BASE}/types/{{code}}/plan/frames", summary="Загрузить кадр (или пару) плана")
@requires(WRITE)
def upload_plan_frames(
    request: HttpRequest,
    hotel_id: str,
    code: str,
    lit: UploadedFile = File(...),
    off: UploadedFile = File(None),
):
    hotel = _hotel(hotel_id)
    result = plan_editor.store_frames(hotel, code, lit=lit, off=off)
    if result.get("ok"):
        _audit(hotel, request, "grms.plan_frames", type=code, night=result.get("night"))
    return result


@router.post(f"{BASE}/types/{{code}}/plan/copy", summary="Скопировать разметку с другого типа")
@requires(WRITE)
def copy_plan(request: HttpRequest, hotel_id: str, code: str, payload: PlanCopyIn):
    hotel = _hotel(hotel_id)
    result = plan_editor.copy_geometry(hotel, code, payload)
    _audit(hotel, request, "grms.plan_copied", type=code, source=payload.from_type)
    return result


# --- Публикация -------------------------------------------------------------


@router.post(f"{BASE}/types/{{code}}/publish", summary="Опубликовать конфигурацию")
@requires(WRITE)
def publish(request: HttpRequest, hotel_id: str, code: str):
    hotel = _hotel(hotel_id)
    config = publishing.publish(hotel, code, actor_id=getattr(request.auth, "pk", None))
    _audit(hotel, request, "grms.published", type=code, version=config.version)
    return {"version": config.version, "published_at": config.published_at}


@router.post(f"{BASE}/types/{{code}}/rollback", summary="Откатиться на версию")
@requires(WRITE)
def rollback(request: HttpRequest, hotel_id: str, code: str, payload: RollbackIn):
    hotel = _hotel(hotel_id)
    config = publishing.rollback(
        hotel, code, to_version=payload.to_version,
        actor_id=getattr(request.auth, "pk", None),
    )
    _audit(hotel, request, "grms.rolled_back", type=code, to=payload.to_version)
    return {"version": config.version, "rolled_back_from": config.rolled_back_from}


@router.get(f"{BASE}/types/{{code}}/versions", summary="История версий")
@requires(READ)
def versions(request: HttpRequest, hotel_id: str, code: str):
    return {"versions": publishing.history(_hotel(hotel_id), code)}


# --- Проверка на живом номере (доступна и отелю — см. CMS) -------------------


@router.post(f"{BASE}/types/{{code}}/check", summary="Прогнать элемент на комнате")
@requires(WRITE)
def check(request: HttpRequest, hotel_id: str, code: str, payload: CheckIn):
    hotel = _hotel(hotel_id)
    return roomcheck.check_element(
        hotel, room_type_code=code, element_slug=payload.element_slug,
        room_number=payload.room_number, capability=payload.capability, value=payload.value,
    )
