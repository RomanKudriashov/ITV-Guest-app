"""
ВАРИАНТЫ НОМЕРОВ — ПРАВКА (партия 63-4, шаг B).

Ручки шагов варианта: завести, основа, зоны, кнопки и их связь с каналами,
тестовая команда, публикация и откат с подтверждением, удаление. Права — на
маршруте (`@requires`), модуль — в `_hotel`, как у остальных ручек grms.
Журнал пишет сервис (`variant_edit`): «было → стало» собирается там, где
известно «было».
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Field, Schema

from apps.grms.services import variant_edit, variants
from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires

from .config import BASE, _hotel

router = PlatformRouter(tags=["platform-grms"])


def _actor(request: HttpRequest):
    return getattr(request.auth, "pk", None)


class VariantIn(Schema):
    title: dict
    plan_level: str = "tiles"
    notes: str = Field(default="", max_length=2000)
    # Копия: код варианта-источника и (для чужого отеля) его id.
    source: str = ""
    source_hotel: str = ""


class BaseIn(Schema):
    title: dict
    notes: str = Field(default="", max_length=2000)
    plan_level: str
    # Имя устройства номера в сервере управления — для инженера; None — не менять.
    device_name_template: str | None = Field(default=None, max_length=255)


class TitleIn(Schema):
    title: dict


class VariantOrderIn(Schema):
    items: list[str]


class ButtonIn(Schema):
    kind: str
    zone: str = ""
    title: dict | None = None


class ButtonEditIn(Schema):
    title: dict | None = None
    zone: str = ""


class LinkIn(Schema):
    capability: str
    variable: str
    # Проверка смысла — предупреждение: принять его можно только явно.
    accept_warning: bool = False


class TestIn(Schema):
    element: str
    room_number: str
    capability: str
    value: int
    # «Номер, что, значение» — то, что оператор видел в окне подтверждения.
    confirm: dict | None = None


class PublishIn(Schema):
    rooms: int


class VariantRollbackIn(Schema):
    to_version: int
    confirm: bool = False


V = f"{BASE}/variants"


@router.get(V, summary="Варианты номеров: сводка")
@requires(READ)
def overview(request: HttpRequest, hotel_id: str):
    # Один путь — один роутер: GET и POST `/variants` живут здесь вместе.
    return variants.overview(_hotel(hotel_id))


@router.get(f"{V}/sources", summary="Варианты других отелей — для копии")
@requires(READ)
def sources(request: HttpRequest, hotel_id: str):
    return {"hotels": variant_edit.copy_sources(_hotel(hotel_id))}


@router.post(V, summary="Новый вариант: с нуля или копией")
@requires(WRITE)
def create(request: HttpRequest, hotel_id: str, payload: VariantIn):
    return variant_edit.create(
        _hotel(hotel_id), title=payload.title, plan_level=payload.plan_level, notes=payload.notes,
        source=payload.source, source_hotel=payload.source_hotel, actor_id=_actor(request),
    )


@router.put(f"{V}/{{code}}", summary="Основа варианта: название, описание, вид экрана")
@requires(WRITE)
def update_base(request: HttpRequest, hotel_id: str, code: str, payload: BaseIn):
    variant_edit.update_base(
        _hotel(hotel_id), code, title=payload.title, notes=payload.notes, plan_level=payload.plan_level,
        device_name_template=payload.device_name_template, actor_id=_actor(request),
    )
    return {"ok": True}


@router.delete(f"{V}/{{code}}", summary="Удалить вариант без номеров")
@requires(WRITE)
def delete(request: HttpRequest, hotel_id: str, code: str):
    variant_edit.delete(_hotel(hotel_id), code, actor_id=_actor(request))
    return {"ok": True}


@router.post(f"{V}/{{code}}/zones", summary="Добавить зону")
@requires(WRITE)
def zone_add(request: HttpRequest, hotel_id: str, code: str, payload: TitleIn):
    return variant_edit.zone_add(_hotel(hotel_id), code, title=payload.title, actor_id=_actor(request))


@router.put(f"{V}/{{code}}/zones/{{zone}}", summary="Переименовать зону")
@requires(WRITE)
def zone_update(request: HttpRequest, hotel_id: str, code: str, zone: str, payload: TitleIn):
    variant_edit.zone_update(_hotel(hotel_id), code, zone, title=payload.title, actor_id=_actor(request))
    return {"ok": True}


@router.delete(f"{V}/{{code}}/zones/{{zone}}", summary="Убрать зону")
@requires(WRITE)
def zone_delete(request: HttpRequest, hotel_id: str, code: str, zone: str):
    return variant_edit.zone_delete(_hotel(hotel_id), code, zone, actor_id=_actor(request))


@router.post(f"{V}/{{code}}/zones-order", summary="Порядок зон")
@requires(WRITE)
def zones_order(request: HttpRequest, hotel_id: str, code: str, payload: VariantOrderIn):
    variant_edit.zones_order(_hotel(hotel_id), code, zones=payload.items, actor_id=_actor(request))
    return {"ok": True}


@router.get(f"{V}/{{code}}/buttons", summary="Кнопки варианта и чего им не хватает")
@requires(READ)
def buttons(request: HttpRequest, hotel_id: str, code: str):
    return {"buttons": variant_edit.buttons(_hotel(hotel_id), code)}


@router.post(f"{V}/{{code}}/buttons", summary="Добавить кнопку")
@requires(WRITE)
def button_add(request: HttpRequest, hotel_id: str, code: str, payload: ButtonIn):
    return variant_edit.element_add(_hotel(hotel_id), code, kind=payload.kind, zone_code=payload.zone, title=payload.title, actor_id=_actor(request))


@router.put(f"{V}/{{code}}/buttons/{{slug}}", summary="Изменить кнопку")
@requires(WRITE)
def button_update(request: HttpRequest, hotel_id: str, code: str, slug: str, payload: ButtonEditIn):
    variant_edit.element_update(_hotel(hotel_id), code, slug, title=payload.title, zone_code=payload.zone, actor_id=_actor(request))
    return {"ok": True}


@router.delete(f"{V}/{{code}}/buttons/{{slug}}", summary="Убрать кнопку")
@requires(WRITE)
def button_delete(request: HttpRequest, hotel_id: str, code: str, slug: str):
    variant_edit.element_delete(_hotel(hotel_id), code, slug, actor_id=_actor(request))
    return {"ok": True}


@router.post(f"{V}/{{code}}/buttons-order", summary="Порядок кнопок")
@requires(WRITE)
def buttons_order(request: HttpRequest, hotel_id: str, code: str, payload: VariantOrderIn):
    variant_edit.elements_order(_hotel(hotel_id), code, slugs=payload.items, actor_id=_actor(request))
    return {"ok": True}


@router.get(f"{V}/{{code}}/buttons/{{slug}}/channels", summary="Подходящие каналы для возможности кнопки")
@requires(READ)
def channels(request: HttpRequest, hotel_id: str, code: str, slug: str, capability: str):
    return {"channels": variant_edit.suggestions(_hotel(hotel_id), code, slug, capability)}


@router.post(f"{V}/{{code}}/buttons/{{slug}}/link", summary="Связать возможность кнопки с каналом")
@requires(WRITE)
def link(request: HttpRequest, hotel_id: str, code: str, slug: str, payload: LinkIn):
    return variant_edit.link(
        _hotel(hotel_id), code, slug, capability=payload.capability, variable_key=payload.variable,
        accept_warning=payload.accept_warning, actor_id=_actor(request),
    )


@router.post(f"{V}/{{code}}/buttons/{{slug}}/unlink", summary="Снять связь возможности")
@requires(WRITE)
def unlink(request: HttpRequest, hotel_id: str, code: str, slug: str, payload: LinkIn):
    variant_edit.unlink(_hotel(hotel_id), code, slug, capability=payload.capability, actor_id=_actor(request))
    return {"ok": True}


@router.post(f"{V}/{{code}}/test", summary="Тестовая команда в номер — с подтверждением")
@requires(WRITE)
def test(request: HttpRequest, hotel_id: str, code: str, payload: TestIn):
    return variant_edit.test_command(
        _hotel(hotel_id), code, slug=payload.element, room_number=payload.room_number,
        capability=payload.capability, value=payload.value, confirm=payload.confirm,
    )


@router.post(f"{V}/{{code}}/publish", summary="Опубликовать — с числом номеров из подтверждения")
@requires(WRITE)
def publish(request: HttpRequest, hotel_id: str, code: str, payload: PublishIn):
    return variant_edit.publish(_hotel(hotel_id), code, rooms=payload.rooms, actor_id=_actor(request))


@router.post(f"{V}/{{code}}/rollback", summary="Вернуть версию — с подтверждением")
@requires(WRITE)
def rollback(request: HttpRequest, hotel_id: str, code: str, payload: VariantRollbackIn):
    return variant_edit.rollback(_hotel(hotel_id), code, to_version=payload.to_version, confirm=payload.confirm, actor_id=_actor(request))
