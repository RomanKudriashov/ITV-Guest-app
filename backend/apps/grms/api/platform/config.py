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
    ConfirmIn,
    CheckIn,
    ElementIn,
    OverrideIn,
    PlanCopyIn,
    PlanGeometryIn,
    PlanLevelIn,
    ReconcileIn,
    RollbackIn,
    ZoneIn,
)
from apps.grms.services import builder, plan_editor, publishing, roomcheck
from apps.hotels.services.platform import console

# ПОЗДНИЙ ИМПОРТ ПРАВ. `hotels.api.platform` подключает этот роутер, а он тянет
# оттуда калитку — на верхнем уровне это кольцо. Права нужны в момент описания
# ручек, то есть при первом обращении к модулю, а не при его загрузке.
from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires

router = PlatformRouter(tags=["platform-grms"])

# Кадр плана — фотография или рендер комнаты: 12 МБ хватает даже для снимка с
# телефона без сжатия, а больше означает, что грузят не то.
MAX_PLAN_BYTES = 12 * 1024 * 1024
# Файл ПНР: пять мегабайт с запасом на любой реальный объект.
MAX_IMPORT_BYTES = 5 * 1024 * 1024

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
    """
    Каталог видов элементов.

    Он ОДИНАКОВ для всех отелей: список зашит в адаптер, и отель не может
    добавить свой вид. Но проверка модуля всё равно нужна — без него у отеля
    нет оборудования, и предлагать конструктор незачем.

    Тело собирается ЗДЕСЬ, а не зовётся из вьюхи CMS: та берёт отель из
    контекста запроса, которого у платформенной ручки нет вовсе. Ровно на этом
    экран конструктора и падал — каталог не приезжал, и вкладка оставалась
    пустой.
    """
    from apps.grms.services import catalog as catalog_svc

    _hotel(hotel_id)
    return {
        "elements": [
            {
                "kind": kind.code,
                "title": kind.title_ru,
                "required": list(kind.required),
                "optional": list(kind.optional),
            }
            for kind in catalog_svc.ELEMENTS.values()
        ],
        "capabilities": {
            code: {
                "value_kind": spec.value_kind,
                "requires_command": spec.requires_command,
                "requires_feedback": spec.requires_feedback,
                "readonly": spec.readonly,
            }
            for code, spec in catalog_svc.CAPABILITIES.items()
        },
    }


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
    """Разбор БЕЗ записи: оператор смотрит и правит, потом подтверждает."""
    from apps.core.errors import ValidationError
    from apps.grms.services import importer

    _hotel(hotel_id)
    if file.size and file.size > MAX_IMPORT_BYTES:
        raise ValidationError("Файл больше 5 МБ", field="file")
    try:
        preview = importer.parse(file.read())
    except importer.ImportError_ as exc:
        # Структура не та — показываем, а не додумываем.
        raise ValidationError(str(exc), field="file") from exc
    return preview.as_dict()


@router.post(f"{BASE}/import/reconcile", summary="Сверить разобранное с живым iRidi")
@requires(WRITE)
def import_reconcile(request: HttpRequest, hotel_id: str, payload: ReconcileIn):
    """Коннектор офлайн — НЕ ошибка: вернётся `checked: false`, но не отказ."""
    from apps.grms.services import importer, reconcile

    hotel = _hotel(hotel_id)
    preview = importer.ImportPreview.from_dict(payload.preview)
    reports = reconcile.reconcile_preview(hotel, preview)
    return {
        "reports": [report.as_dict() for report in reports],
        "checked": all(report.checked for report in reports),
    }


@router.post(f"{BASE}/import/confirm", summary="Сохранить подтверждённый импорт")
@requires(WRITE)
def import_confirm(request: HttpRequest, hotel_id: str, payload: ConfirmIn):
    from apps.core.errors import ValidationError
    from apps.grms.services import importer

    hotel = _hotel(hotel_id)
    preview = importer.ImportPreview.from_dict(payload.preview)
    if not preview.types:
        raise ValidationError("Нечего сохранять: в предпросмотре нет типов", field="preview")
    result = builder.save_import(hotel, preview, replace=payload.replace)
    _audit(hotel, request, "grms.import_confirmed", types=len(preview.types))
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


# --- Диагностика инженера ---------------------------------------------------


@router.get(f"{BASE}/diagnostics", summary="Журнал обмена с оборудованием: полностью")
@requires(READ)
def diagnostics_journal(
    request: HttpRequest,
    hotel_id: str,
    room: str = "",
    element_kind: str = "",
    outcome: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 100,
):
    """
    ЖУРНАЛ ЦЕЛИКОМ — включая сырой ответ оборудования.

    Это и есть вторая глубина. Инженеру на объекте нужен ответ на вопрос «что
    реально сказало железо»: тег обмена, отправленное значение, сырой ответ,
    длительность. По ним видно, на каком звене оборвалось, и он не поедет
    проверять коннектор, у которого недоступен один канал.

    Отельская ручка (`/cms/grms/diagnostics`) те же строки отдаёт урезанными:
    администратору «iRidi вернул status:false» читается как поломка приложения.
    """
    from apps.grms.services import diagnostics

    result = diagnostics.journal(
        _hotel(hotel_id),
        room=room,
        element_kind=element_kind,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return {**result, "depth": "engineer"}


@router.get(f"{BASE}/diagnostics/link", summary="Связь по звеньям")
@requires(READ)
def diagnostics_link(request: HttpRequest, hotel_id: str):
    from apps.grms.services import diagnostics

    return diagnostics.link_state(_hotel(hotel_id))


@router.get(f"{BASE}/diagnostics/filters", summary="Значения фильтров журнала")
@requires(READ)
def diagnostics_filters(request: HttpRequest, hotel_id: str):
    from apps.grms.services import diagnostics

    from apps.grms.services import catalog as catalog_svc

    _hotel(hotel_id)
    return {
        "element_kinds": [
            {"code": code, "title": title} for code, title in catalog_svc.ELEMENT_CHOICES
        ],
        "outcomes": diagnostics.outcomes(),
    }
