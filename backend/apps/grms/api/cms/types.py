"""
CMS: типы номеров, конструктор, проверка на живом номере, публикация.

Раздел закрыт МОДУЛЕМ `room_control`, а не только ролью: калитка
`services/access.hotel_with_module()` стоит на входе каждого эндпоинта, а не на
экране. Без неё отель без модуля дотянулся бы до оборудования запросом мимо
интерфейса.

Гостю здесь ничего не появляется: маршруты живут под `/api/v1/cms`, куда
гостевой токен не пускают в принципе (роутер закрыт `CmsAuth`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.grms.schemas.cms import BindingIn, CheckIn, ElementIn, OverrideIn, RollbackIn, ZoneIn
from apps.grms.services import builder, publishing, roomcheck
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])


# --- Типы и переменные ------------------------------------------------------


@router.get("/grms/types", summary="Типы номеров с переменными")
def list_types(request: HttpRequest):
    return {"types": builder.list_types_with_variables(hotel_with_module())}


# --- Конструктор ------------------------------------------------------------




@router.post("/grms/types/{code}/zones", summary="Добавить зону")
def add_zone(request: HttpRequest, code: str, payload: ZoneIn):
    zone = builder.add_zone(
        hotel_with_module(), room_type_code=code, code=payload.code,
        title=payload.title, sort_order=payload.sort_order,
    )
    return {"code": zone.code}




@router.post("/grms/types/{code}/elements", summary="Поставить элемент каталога")
def add_element(request: HttpRequest, code: str, payload: ElementIn):
    element = builder.add_element(
        hotel_with_module(), room_type_code=code, kind=payload.kind, slug=payload.slug,
        zone_code=payload.zone_code, title=payload.title, sort_order=payload.sort_order,
    )
    return {"slug": element.slug, "kind": element.kind}




@router.post("/grms/types/{code}/bindings", summary="Связать возможность с переменной")
def bind(request: HttpRequest, code: str, payload: BindingIn):
    binding = builder.bind(
        hotel_with_module(), room_type_code=code, element_slug=payload.element_slug,
        capability=payload.capability, variable_key=payload.variable_key,
        trigger_value=payload.trigger_value,
    )
    return {"element": payload.element_slug, "capability": binding.capability}


@router.get("/grms/types/{code}/status", summary="Что опубликуется, а что скрыто")
def type_status(request: HttpRequest, code: str):
    return builder.type_status(hotel_with_module(), code)




@router.post("/grms/types/{code}/device-override", summary="Имя устройства для комнаты")
def device_override(request: HttpRequest, code: str, payload: OverrideIn):
    builder.set_device_override(
        hotel_with_module(), room_number=payload.room_number, device_name=payload.device_name
    )
    return {"room": payload.room_number, "device": payload.device_name}


# --- Проверка на живом номере -----------------------------------------------




@router.post("/grms/types/{code}/check", summary="Прогнать элемент на комнате")
def check(request: HttpRequest, code: str, payload: CheckIn):
    return roomcheck.check_element(
        hotel_with_module(), room_type_code=code, element_slug=payload.element_slug,
        room_number=payload.room_number, capability=payload.capability, value=payload.value,
    )


# --- Публикация -------------------------------------------------------------


@router.post("/grms/types/{code}/publish", summary="Опубликовать конфигурацию")
def publish(request: HttpRequest, code: str):
    hotel = hotel_with_module()
    config = publishing.publish(hotel, code, actor_id=getattr(request.auth, "pk", None))
    return {"version": config.version, "published_at": config.published_at}




@router.post("/grms/types/{code}/rollback", summary="Откатиться на версию")
def rollback(request: HttpRequest, code: str, payload: RollbackIn):
    hotel = hotel_with_module()
    config = publishing.rollback(
        hotel, code, to_version=payload.to_version,
        actor_id=getattr(request.auth, "pk", None),
    )
    return {"version": config.version, "rolled_back_from": config.rolled_back_from}


@router.get("/grms/types/{code}/versions", summary="История версий")
def versions(request: HttpRequest, code: str):
    return {"versions": publishing.history(hotel_with_module(), code)}
