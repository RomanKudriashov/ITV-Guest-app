"""
Схемы отеля, номеров, локаций и расписаний — CMS.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from typing import Any

from ninja import Schema
from ninja import Field



class ScheduleIntervalIn(Schema):
    weekday: int
    start_time: str
    end_time: str
    day_part: str = ""

class ScheduleIn(Schema):
    name: str
    is_always_open: bool = False
    intervals: list[ScheduleIntervalIn] = []

class SchedulePatch(Schema):
    name: str | None = None
    is_always_open: bool | None = None
    intervals: list[ScheduleIntervalIn] | None = None

class ScheduleOut(Schema):
    id: str
    name: str
    is_always_open: bool
    intervals: list[dict[str, Any]]

class RoomIn(Schema):
    number: str
    floor: str = ""
    zone: str = ""
    is_active: bool = True

class RoomPatch(Schema):
    number: str | None = None
    floor: str | None = None
    zone: str | None = None
    is_active: bool | None = None

class RoomOut(Schema):
    id: str
    number: str
    floor: str
    zone: str
    source: str
    is_active: bool
    guest_url: str

class BulkRoomsIn(Schema):
    # `from` — ключевое слово Python; принимаем его по alias, в коде — from_.
    from_: int = Field(alias="from")
    to: int
    floor: str = ""
    zone: str = ""
    prefix: str = ""
    suffix: str = ""

class LocationIn(Schema):
    title: dict[str, str]
    code: str | None = None
    kind: str = "in_room"
    requires_refinement: bool = False
    refinement_label: dict[str, str] = {}
    schedule_id: str | None = None
    sort_order: int = 0
    is_active: bool = True

class LocationPatch(Schema):
    title: dict[str, str] | None = None
    kind: str | None = None
    requires_refinement: bool | None = None
    refinement_label: dict[str, str] | None = None
    schedule_id: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    # Стоимость доставки в эту локацию, копейки; 0 = бесплатно.
    delivery_fee_minor: int | None = None

class MatrixCell(Schema):
    location_id: str
    enabled: bool = False
    delivery_modes: list[str] = []

class MatrixRowIn(Schema):
    category_id: str
    cells: list[MatrixCell]

class ServiceIn(Schema):
    """Отель заводит ЗАВЕДЕНИЕ; бригаду под него сервер создаёт сам."""

    type: str = "custom"
    public_name: dict[str, str]
    tagline: dict[str, str] = {}
    is_guest_facing: bool | None = None
    code: str | None = None
    schedule_id: str | None = None
    sla_minutes: int | None = None
    is_active: bool = True
    image_id: str | None = None
    sort_order: int | None = None

class ServicePatch(Schema):
    type: str | None = None
    public_name: dict[str, str] | None = None
    tagline: dict[str, str] | None = None
    is_guest_facing: bool | None = None
    schedule_id: str | None = None
    sla_minutes: int | None = None
    is_active: bool | None = None
    image_id: str | None = None
    sort_order: int | None = None
    # Своя коммерция заведения: null = наследовать значение отеля.
    service_fee_bp: int | None = None
    tip_presets: list[int] | None = None
    min_order_minor: int | None = None
    free_delivery_threshold_minor: int | None = None
    price_round_to_minor: int | None = None

class HomeSettingsIn(Schema):
    """
    Настройки главной. Координаты — ПАРОЙ: одна широта без долготы не точка, и
    хранить половину координаты незачем. Пустая пара — «координат нет», и это
    законное состояние, а не ошибка ввода.
    """

    weather: bool = False
    room_status: bool = True
    latitude: float | None = None
    longitude: float | None = None
    # Город — подпись к погоде и часам, на языке гостя. Переводы, а не строка.
    city: dict = {}
    # Часовой пояс отеля — ИМЕНЕМ ЗОНЫ, а не смещением. Смещение врёт дважды в
    # год на переходе и не умеет получаса (Индия, Иран); имя знает и то и другое.
    timezone: str | None = None

class CommerceSettingsIn(Schema):
    """Все поля необязательны — PATCH меняет только присланное."""

    service_fee_bp: int | None = None
    tax_bp: int | None = None
    tax_inclusive: bool | None = None
    tip_presets: list[int] | None = None
    free_delivery_threshold_minor: int | None = None
    price_round_to_minor: int | None = None


# --- Бренд -------------------------------------------------------------------


class BrandOut(Schema):
    id: str
    name: str
    preset: str
    tokens: dict[str, Any]
    updated_at: str


class BrandPatch(Schema):
    tokens: dict[str, Any] = {}


class ApplyPresetIn(Schema):
    preset: str
