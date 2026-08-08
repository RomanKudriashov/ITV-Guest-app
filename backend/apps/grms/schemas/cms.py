"""
Схемы конфигурации управления номером — CMS.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from ninja import Schema



class ReconcileIn(Schema):
    preview: dict

class ConfirmIn(Schema):
    preview: dict
    replace: bool = False

class ZoneIn(Schema):
    code: str
    title: dict
    sort_order: int = 0

class ElementIn(Schema):
    kind: str
    slug: str
    zone_code: str = ""
    title: dict | None = None
    sort_order: int = 0

class BindingIn(Schema):
    element_slug: str
    capability: str
    variable_key: str
    trigger_value: int | None = None

class OverrideIn(Schema):
    room_number: str
    device_name: str

class CheckIn(Schema):
    element_slug: str
    room_number: str
    capability: str = ""
    # Без значения выполняется ТОЛЬКО чтение: проверить маппинг в занятом
    # номере, ничего там не переключая.
    value: int | None = None

class RollbackIn(Schema):
    to_version: int

class PinIn(Schema):
    room_number: str
    # Пусто — снять PIN с номера.
    pin: str = ""

class DemoEntryIn(Schema):
    enabled: bool

class PlanGeometryIn(Schema):
    """Черновик разметки. Всё в ПРОЦЕНТАХ от кадра — пикселей здесь нет."""

    aspect: float | None = None
    zones: list[dict] = []
    windows: list[dict] = []
    points: list[dict] = []
    # Номера в коридоре зеркальны: один план закрывает вдвое больше комнат.
    mirrored: bool = False

class PlanCopyIn(Schema):
    source: str
