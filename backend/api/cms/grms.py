"""
CMS: управление номером (GRMS) — импорт, конструктор, публикация.

Весь раздел закрыт МОДУЛЕМ `room_control`, а не только ролью. Проверка стоит
на входе каждого эндпоинта, а не на экране: без неё отель без модуля дотянулся
бы до оборудования запросом мимо интерфейса.

Гостю здесь ничего не появляется: эти маршруты живут под `/api/v1/cms`, куда
гостевой токен не пускают в принципе (роутер закрыт `CmsAuth`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import File, Router, Schema
from ninja.files import UploadedFile

from apps.core.context import require_hotel_id
from apps.core.errors import DomainError, ValidationError
from apps.grms import builder, catalog, importer, publishing, reconcile, roomcheck
from apps.grms.models import RoomType, Variable
from apps.hotels.models import Hotel, HotelModule
from apps.hotels.module_registry import enabled_module_codes

router = Router(tags=["cms-grms"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024


class ModuleDisabled(DomainError):
    status = 403
    code = "module_disabled"


def _hotel() -> Hotel:
    hotel = Hotel.objects.get(pk=require_hotel_id())
    if HotelModule.Code.ROOM_CONTROL not in enabled_module_codes(hotel):
        raise ModuleDisabled("Модуль «Управление номером» не подключён")
    return hotel


# --- Каталог ----------------------------------------------------------------


@router.get("/grms/catalog", summary="Фиксированный каталог элементов")
def get_catalog(request: HttpRequest):
    """
    Каталог отдаётся С СЕРВЕРА, а не зашит во фронт: администратор не может
    добавить свой вид элемента, и список обязан совпадать с тем, что умеет
    исполнить адаптер.
    """
    _hotel()
    return {
        "elements": [
            {
                "kind": kind.code,
                "title": kind.title_ru,
                "required": list(kind.required),
                "optional": list(kind.optional),
            }
            for kind in catalog.ELEMENTS.values()
        ],
        "capabilities": {
            code: {
                "value_kind": spec.value_kind,
                "requires_command": spec.requires_command,
                "requires_feedback": spec.requires_feedback,
                "readonly": spec.readonly,
            }
            for code, spec in catalog.CAPABILITIES.items()
        },
    }


# --- Импорт -----------------------------------------------------------------


@router.post("/grms/import/preview", summary="Разобрать Excel ПНР (без сохранения)")
def import_preview(request: HttpRequest, file: UploadedFile = File(...)):
    """
    Разбор БЕЗ записи. Администратор смотрит результат и предупреждения, при
    необходимости правит и только потом подтверждает (ТЗ §9).
    """
    _hotel()
    if file.size and file.size > MAX_IMPORT_BYTES:
        raise ValidationError("Файл больше 5 МБ", field="file")
    try:
        preview = importer.parse(file.read())
    except importer.ImportError_ as exc:
        # Структура не та — показываем, а не додумываем.
        raise ValidationError(str(exc), field="file") from exc
    return preview.as_dict()


class ReconcileIn(Schema):
    preview: dict


@router.post("/grms/import/reconcile", summary="Сверить разобранное с живым iRidi")
def import_reconcile(request: HttpRequest, payload: ReconcileIn):
    """
    Excel — не источник истины: на объекте у ТИП1 нашлось 12 групп света
    против 10 в файле. Сверка читает эталонную комнату каждого типа и
    подсвечивает расхождения.

    Коннектор офлайн — НЕ ошибка: вернётся `checked: false`, сохранение
    не блокируется.
    """
    hotel = _hotel()
    preview = importer.ImportPreview.from_dict(payload.preview)
    reports = reconcile.reconcile_preview(hotel, preview)
    return {
        "reports": [report.as_dict() for report in reports],
        "checked": all(report.checked for report in reports),
    }


class ConfirmIn(Schema):
    preview: dict
    replace: bool = False


@router.post("/grms/import/confirm", summary="Сохранить подтверждённый импорт")
def import_confirm(request: HttpRequest, payload: ConfirmIn):
    hotel = _hotel()
    preview = importer.ImportPreview.from_dict(payload.preview)
    if not preview.types:
        raise ValidationError("Нечего сохранять: в предпросмотре нет типов", field="preview")
    return builder.save_import(hotel, preview, replace=payload.replace)


# --- Типы и переменные ------------------------------------------------------


@router.get("/grms/types", summary="Типы номеров с переменными")
def list_types(request: HttpRequest):
    from apps.core.context import tenant_context

    hotel = _hotel()
    with tenant_context(hotel):
        result = []
        for room_type in RoomType.objects.all():
            result.append(
                {
                    "code": room_type.code,
                    "title": room_type.title,
                    "device_name_template": room_type.device_name_template,
                    "rooms": list(
                        room_type.rooms.select_related("room").values_list(
                            "room__number", flat=True
                        )
                    ),
                    "variables": list(
                        Variable.objects.filter(room_type=room_type).values(
                            "key", "command", "feedback", "value_kind",
                            "min_value", "max_value", "raw_range", "description",
                        )
                    ),
                }
            )
    return {"types": result}


# --- Конструктор ------------------------------------------------------------


class ZoneIn(Schema):
    code: str
    title: dict
    sort_order: int = 0


@router.post("/grms/types/{code}/zones", summary="Добавить зону")
def add_zone(request: HttpRequest, code: str, payload: ZoneIn):
    zone = builder.add_zone(
        _hotel(), room_type_code=code, code=payload.code,
        title=payload.title, sort_order=payload.sort_order,
    )
    return {"code": zone.code}


class ElementIn(Schema):
    kind: str
    slug: str
    zone_code: str = ""
    title: dict | None = None
    sort_order: int = 0


@router.post("/grms/types/{code}/elements", summary="Поставить элемент каталога")
def add_element(request: HttpRequest, code: str, payload: ElementIn):
    element = builder.add_element(
        _hotel(), room_type_code=code, kind=payload.kind, slug=payload.slug,
        zone_code=payload.zone_code, title=payload.title, sort_order=payload.sort_order,
    )
    return {"slug": element.slug, "kind": element.kind}


class BindingIn(Schema):
    element_slug: str
    capability: str
    variable_key: str
    trigger_value: int | None = None


@router.post("/grms/types/{code}/bindings", summary="Связать возможность с переменной")
def bind(request: HttpRequest, code: str, payload: BindingIn):
    binding = builder.bind(
        _hotel(), room_type_code=code, element_slug=payload.element_slug,
        capability=payload.capability, variable_key=payload.variable_key,
        trigger_value=payload.trigger_value,
    )
    return {"element": payload.element_slug, "capability": binding.capability}


@router.get("/grms/types/{code}/status", summary="Что опубликуется, а что скрыто")
def type_status(request: HttpRequest, code: str):
    return builder.type_status(_hotel(), code)


class OverrideIn(Schema):
    room_number: str
    device_name: str


@router.post("/grms/types/{code}/device-override", summary="Имя устройства для комнаты")
def device_override(request: HttpRequest, code: str, payload: OverrideIn):
    builder.set_device_override(
        _hotel(), room_number=payload.room_number, device_name=payload.device_name
    )
    return {"room": payload.room_number, "device": payload.device_name}


# --- Проверка на живом номере -----------------------------------------------


class CheckIn(Schema):
    element_slug: str
    room_number: str
    capability: str = ""
    # Без значения выполняется ТОЛЬКО чтение: проверить маппинг в занятом
    # номере, ничего там не переключая.
    value: int | None = None


@router.post("/grms/types/{code}/check", summary="Прогнать элемент на комнате")
def check(request: HttpRequest, code: str, payload: CheckIn):
    return roomcheck.check_element(
        _hotel(), room_type_code=code, element_slug=payload.element_slug,
        room_number=payload.room_number, capability=payload.capability, value=payload.value,
    )


# --- Публикация -------------------------------------------------------------


@router.post("/grms/types/{code}/publish", summary="Опубликовать конфигурацию")
def publish(request: HttpRequest, code: str):
    hotel = _hotel()
    config = publishing.publish(hotel, code, actor_id=getattr(request.auth, "pk", None))
    return {"version": config.version, "published_at": config.published_at}


class RollbackIn(Schema):
    to_version: int


@router.post("/grms/types/{code}/rollback", summary="Откатиться на версию")
def rollback(request: HttpRequest, code: str, payload: RollbackIn):
    hotel = _hotel()
    config = publishing.rollback(
        hotel, code, to_version=payload.to_version,
        actor_id=getattr(request.auth, "pk", None),
    )
    return {"version": config.version, "rolled_back_from": config.rolled_back_from}


@router.get("/grms/types/{code}/versions", summary="История версий")
def versions(request: HttpRequest, code: str):
    return {"versions": publishing.history(_hotel(), code)}
