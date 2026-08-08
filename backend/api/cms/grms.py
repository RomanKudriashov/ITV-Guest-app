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
from ninja import File, Router
from apps.grms.schemas.cms import (
    BindingIn,
    CheckIn,
    ConfirmIn,
    DemoEntryIn,
    ElementIn,
    OverrideIn,
    PinIn,
    PlanCopyIn,
    PlanGeometryIn,
    ReconcileIn,
    RollbackIn,
    ZoneIn,
)
from ninja.files import UploadedFile

from apps.core.context import require_hotel_id, tenant_context
from apps.core.errors import DomainError, NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.grms import builder, catalog, importer, publishing, reconcile, roomcheck
from apps.grms.models import RoomType, Variable
from apps.hotels.models import Hotel, HotelModule
from apps.hotels.module_registry import enabled_module_codes

router = Router(tags=["cms-grms"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024
# Кадр плана — фотография или рендер комнаты: 12 МБ хватает даже для снимка
# с телефона без сжатия, а больше означает, что грузят не то.
MAX_PLAN_BYTES = 12 * 1024 * 1024


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




@router.post("/grms/types/{code}/zones", summary="Добавить зону")
def add_zone(request: HttpRequest, code: str, payload: ZoneIn):
    zone = builder.add_zone(
        _hotel(), room_type_code=code, code=payload.code,
        title=payload.title, sort_order=payload.sort_order,
    )
    return {"code": zone.code}




@router.post("/grms/types/{code}/elements", summary="Поставить элемент каталога")
def add_element(request: HttpRequest, code: str, payload: ElementIn):
    element = builder.add_element(
        _hotel(), room_type_code=code, kind=payload.kind, slug=payload.slug,
        zone_code=payload.zone_code, title=payload.title, sort_order=payload.sort_order,
    )
    return {"slug": element.slug, "kind": element.kind}




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




@router.post("/grms/types/{code}/device-override", summary="Имя устройства для комнаты")
def device_override(request: HttpRequest, code: str, payload: OverrideIn):
    builder.set_device_override(
        _hotel(), room_number=payload.room_number, device_name=payload.device_name
    )
    return {"room": payload.room_number, "device": payload.device_name}


# --- Проверка на живом номере -----------------------------------------------




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


# --- Доступ гостя: PIN проживания и демо-вход -------------------------------






# Текст, который администратор обязан увидеть рядом с переключателем. Живёт на
# сервере, а не в вёрстке: послабление продуктовое, и формулировка не должна
# зависеть от того, какой экран его показывает.
DEMO_ENTRY_WARNING = (
    "Демо-вход ОСЛАБЛЯЕТ доступ к управлению номером: подтвердить номер можно "
    "будет без PIN проживания, по одному лишь номеру комнаты. Включать только "
    "на время демонстрации."
)


@router.get("/grms/access", summary="Кто может управлять номером: PIN и демо-вход")
def access_state(request: HttpRequest):
    """
    Показывает и состояние демо-входа, и у каких номеров заведён PIN.

    Сам PIN не возвращается никогда — в базе лежит только хэш. Ресепшен видит
    код в момент заведения, а не «посмотреть, какой там был».
    """
    from apps.grms.models import RoomPin
    from apps.grms.guest import demo_entry_enabled

    hotel = _hotel()
    with tenant_context(hotel):
        rooms = [
            {
                "room": record.room.number,
                "issued_at": record.issued_at,
                "valid_until": record.valid_until,
                "is_active": record.is_active,
            }
            for record in RoomPin.objects.select_related("room").order_by("room__number")
        ]
    return {
        "demo_entry": {
            "enabled": demo_entry_enabled(hotel),
            "warning": DEMO_ENTRY_WARNING,
        },
        "pins": rooms,
    }


@router.post("/grms/access/pin", summary="Завести или снять PIN проживания номера")
def set_room_pin(request: HttpRequest, payload: PinIn):
    """
    PIN виден ресепшену ровно один раз — в момент заведения его назвал сам
    администратор. Смена PIN сбрасывает подтверждение у всех устройств этой
    комнаты: именно этим отмечается смена гостя, пока нет выезда по PMS.
    """
    from apps.grms import pin as room_pin
    from apps.hotels.models import Room

    hotel = _hotel()
    with tenant_context(hotel):
        room = Room.objects.filter(number=payload.room_number).first()
    if room is None:
        raise NotFoundError(f"Номер «{payload.room_number}» не найден")

    if not payload.pin:
        room_pin.clear_pin(hotel, room)
        return {"room": room.number, "has_pin": False}

    record = room_pin.set_pin(hotel, room, pin=payload.pin)
    return {"room": room.number, "has_pin": True, "issued_at": record.issued_at}


@router.post("/grms/access/demo-entry", summary="Демо-вход без PIN (временное послабление)")
def set_demo_entry(request: HttpRequest, payload: DemoEntryIn):
    """
    ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ MVP, а не штатное поведение. Выключено по умолчанию.

    Ослабляет РОВНО step-up: резолв по-прежнему идёт из сессии, чужой номер
    по-прежнему недостижим, тело команды по-прежнему `{controlId, value}`.
    Каждый вход без PIN пишется в журнал отдельным событием.
    """
    hotel = _hotel()
    with tenant_context(hotel):
        module = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL).first()
        if module is None:
            raise NotFoundError("Модуль «Управление номером» не подключён")
        config = dict(module.config or {})
        config["guest_entry_demo"] = bool(payload.enabled)
        module.config = config
        module.save(update_fields=["config", "updated_at"])

    AuditLog.record(
        "grms.demo_entry_toggled",
        actor_type=AuditLog.ActorType.STAFF,
        actor_id=getattr(request.user, "pk", None),
        object_type="grms.hotel",
        object_id=hotel.pk,
        payload={"enabled": bool(payload.enabled)},
        hotel_id=hotel.pk,
    )
    return {"enabled": bool(payload.enabled), "warning": DEMO_ENTRY_WARNING}


# --- Редактор плана ---------------------------------------------------------
#
# План — это ДВА КАДРА и геометрия в процентах. Кадры попадают сюда двумя
# путями, и оба обязательны: администратор либо приносит один светлый кадр и
# ночной считается на сервере, либо приносит свою пару — и тогда она
# ПРОВЕРЯЕТСЯ. Молча принять неподходящую пару нельзя: расхождение кадров
# всплывёт на объекте, когда номер уже сдан.




@router.get("/grms/types/{code}/plan", summary="План типа: кадры, разметка, что можно привязать")
def get_plan(request: HttpRequest, code: str):
    """
    Всё, что нужно редактору, одним ответом: черновик разметки, состояние
    кадров и СПИСОК элементов для привязки.

    Список приезжает с сервера, потому что привязка — это выбор из
    опубликованного конфига, а не ввод кода руками: набранный руками
    `controlId` живёт до первого переименования элемента.
    """
    from apps.grms import plan as plan_geometry
    from apps.media.models import MediaAsset

    hotel = _hotel()
    with tenant_context(hotel):
        room_type = builder._type(code)
        draft = dict(room_type.plan or {})

        def frame(asset_id: str | None) -> dict | None:
            if not asset_id:
                return None
            asset = MediaAsset.objects.filter(pk=asset_id).first()
            if asset is None:
                return None
            return {
                "id": str(asset.pk),
                "status": asset.status,
                "url": asset.url(plan_geometry.PLATE_VARIANT) or asset.url("card"),
                "width": asset.width,
                "height": asset.height,
            }

        status = publishing.current(hotel, code)
        controls = [
            {
                "controlId": control["controlId"],
                "title": (control.get("title") or {}).get("ru") or control["controlId"],
                "kind": control.get("kind") or "",
                "zone": zone.get("code") or "",
            }
            for zone in ((status.payload if status else {}) or {}).get("zones", [])
            for control in zone.get("controls", [])
        ]

    return {
        "geometry": {
            "aspect": draft.get("aspect"),
            "zones": draft.get("zones") or [],
            "windows": draft.get("windows") or [],
            "points": draft.get("points") or [],
            "mirrored": bool(draft.get("mirrored")),
        },
        "frames": {
            "lit": frame(draft.get("asset_id")),
            "off": frame(draft.get("asset_off_id")),
            "off_source": draft.get("asset_off_source") or "",
        },
        # Привязывать можно только к ОПУБЛИКОВАННЫМ элементам: план едет гостю
        # вместе с опубликованной версией, и ссылка на черновой элемент
        # означала бы точку управления, которой у гостя нет.
        "controls": controls,
        "published": bool(status),
    }


@router.put("/grms/types/{code}/plan", summary="Сохранить разметку плана")
def put_plan(request: HttpRequest, code: str, payload: PlanGeometryIn):
    """
    Разметка сохраняется В ЧЕРНОВИК типа, а не в опубликованную версию.

    Гость видит копию, попавшую в снимок при публикации: правка разметки не
    уезжает в номер мимо публикации, а откат конфигурации возвращает геометрию
    своей версии.
    """
    from apps.grms import plan as plan_geometry

    hotel = _hotel()
    with tenant_context(hotel):
        room_type = builder._type(code)

        def apply(plan: dict) -> None:
            plan.update(
                {
                    "aspect": payload.aspect or plan.get("aspect"),
                    "zones": payload.zones,
                    "windows": payload.windows,
                    "points": payload.points,
                    "mirrored": payload.mirrored,
                }
            )

        # Под блокировкой: рядом может идти фоновый расчёт ночного кадра, и он
        # пишет в ту же колонку. См. `plan.edit`.
        plan_geometry.edit(room_type, apply)

        AuditLog.record(
            "grms.plan_saved",
            actor_type=AuditLog.ActorType.STAFF,
            object_type="grms.room_type",
            object_id=room_type.pk,
            payload={"type": code, "zones": len(payload.zones), "windows": len(payload.windows)},
            hotel_id=hotel.pk,
        )
    return get_plan(request, code)


@router.post("/grms/types/{code}/plan/frames", summary="Загрузить кадр (или пару) плана")
def upload_plan_frames(
    request: HttpRequest,
    code: str,
    lit: UploadedFile = File(...),
    off: UploadedFile = File(None),
):
    """
    Один светлый кадр — ночной считается на сервере фоновой задачей.
    Пара своих кадров — принимается ТОЛЬКО при совпадении.

    Проверка пары не перестраховка: два отдельно сгенерированных кадра того же
    номера разошлись по габаритам примерно на 21%, и мебель на границе
    включённой зоны двоилась. Не совпало — честно отвечаем причиной и
    предлагаем посчитать ночной кадр из светлого; тогда совмещение гарантировано
    построением, а не удачей.
    """
    from apps.grms import nightframe, pair
    from apps.grms import plan as plan_geometry
    from apps.grms.tasks import bake_room_plan_night
    from apps.media.models import MediaAsset
    from apps.media.services import upload_asset

    hotel = _hotel()
    lit_raw = lit.read()
    if len(lit_raw) > MAX_PLAN_BYTES:
        raise ValidationError("Кадр больше 12 МБ", field="lit")

    verdict = None
    off_raw = off.read() if off is not None else None
    if off_raw is not None:
        if len(off_raw) > MAX_PLAN_BYTES:
            raise ValidationError("Кадр больше 12 МБ", field="off")
        verdict = pair.compare(lit_raw, off_raw)
        if not verdict.ok:
            # НЕ сохраняем ничего: половина пары в конфигурации хуже, чем её
            # отсутствие — план собрался бы с кадром, которому не место.
            return {
                "ok": False,
                "pair": verdict.as_dict,
                "hint": "computed_night_frame",
            }

    with tenant_context(hotel):
        room_type = builder._type(code)
        lit_asset = upload_asset(
            content=lit_raw,
            filename=lit.name or "plan.png",
            kind=MediaAsset.Kind.ROOM_PLAN,
            content_type=lit.content_type or "image/png",
            alt={"ru": "План номера, свет включён"},
        )
        off_asset = None
        if off_raw is not None:
            off_asset = upload_asset(
                content=off_raw,
                filename=off.name or "plan-off.png",
                kind=MediaAsset.Kind.ROOM_PLAN,
                content_type=off.content_type or "image/png",
                alt={"ru": "План номера, свет выключен"},
            )

        # Пропорция берётся ИЗ ФАЙЛА: спрашивать её у администратора значит
        # спрашивать то, что и так известно, и однажды получить неверный ответ.
        aspect = None
        try:
            from PIL import Image
            import io as _io

            with Image.open(_io.BytesIO(lit_raw)) as image:
                aspect = round(image.width / image.height, 4)
        except Exception:  # noqa: BLE001 — не смогли прочитать, спросим позже
            aspect = None

        def apply(plan: dict) -> None:
            plan["asset_id"] = str(lit_asset.pk)
            plan.pop("asset_off_id", None)
            plan["asset_off_source"] = ""
            if off_asset is not None:
                plan["asset_off_id"] = str(off_asset.pk)
                plan["asset_off_source"] = "uploaded"
            if aspect:
                plan["aspect"] = aspect

        # Разметка при этом СОХРАНЯЕТСЯ: кадр меняют и на размеченном типе,
        # а координаты в процентах переживают смену рендера. См. `plan.edit`.
        plan_geometry.edit(room_type, apply)

    if off_raw is None:
        # Считаем ночной кадр фоном: расчёт идёт секунды, а размечать план
        # можно уже сейчас.
        bake_room_plan_night.delay(
            hotel_id=str(hotel.pk), room_type_code=code, lit_asset_id=str(lit_asset.pk)
        )

    return {
        "ok": True,
        "pair": verdict.as_dict if verdict else None,
        "night": "baking" if off_raw is None else "uploaded",
        "plan": get_plan(request, code),
    }




@router.post("/grms/types/{code}/plan/copy", summary="Скопировать разметку с другого типа")
def copy_plan(request: HttpRequest, code: str, payload: PlanCopyIn):
    """
    Планировки в отеле повторяются, и размечать одно и то же второй раз —
    работа без содержания. Копируется ГЕОМЕТРИЯ, но не кадры: у другого типа
    свой рендер, и подставлять его сюда значит показать гостю чужую комнату.

    Привязки зон переносятся как есть и проверяются при публикации: если у
    этого типа нет такого элемента, публикация не пройдёт и скажет, чего не
    хватает.
    """
    from apps.grms import plan as plan_geometry

    hotel = _hotel()
    with tenant_context(hotel):
        source = builder._type(payload.source)
        target = builder._type(code)
        if source.pk == target.pk:
            raise ValidationError("Копировать не с чего: это тот же тип", field="source")
        donor = dict(source.plan or {})
        if not donor.get("zones"):
            raise ValidationError("У выбранного типа нет разметки", field="source")

        def apply(plan: dict) -> None:
            plan.update(
                {
                    "zones": donor.get("zones") or [],
                    "windows": donor.get("windows") or [],
                    "points": donor.get("points") or [],
                    "mirrored": bool(donor.get("mirrored")),
                }
            )

        # Кадры остаются свои — копируется РАЗМЕТКА. Под блокировкой: рядом
        # может считаться ночной кадр этого же типа. См. `plan.edit`.
        plan_geometry.edit(target, apply)
    return get_plan(request, code)
