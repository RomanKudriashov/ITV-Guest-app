"""
Схемы NaviRoom Control: флот, тарифы, команда.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from datetime import date

from ninja import Schema



class HotelCreateIn(Schema):
    subdomain: str
    name: str
    admin_email: str
    timezone: str = "Europe/Moscow"
    currency: str = "RUB"
    languages: list[str] = ["ru", "en"]
    preset: str = "midnight_navy"
    # `admin_password` здесь НЕТ: пароль генерируется и уходит письмом
    # администратору. Дать оператору задать его значило бы вернуть тот же
    # захват тенанта другим путём.
    # Происхождение. Автотесты обязаны присылать "test" — только так их отели
    # отличимы от настоящих не угадыванием по имени, а признаком.
    origin: str = "live"
    # Стартовый шаблон. Пусто — отель заводится голым, как и раньше.
    template: str | None = None

class HotelPatchIn(Schema):
    # Тарифа здесь НЕТ: тарифов больше нет вовсе (партия 62-E1).
    # Название — строкой (основной язык) или словарём по языкам отеля (62-C).
    name: str | dict | None = None
    timezone: str | None = None
    currency: str | None = None
    # Число знаков после запятой — ПОКАЗАТЕЛЬ СТЕПЕНИ, а не множитель: 2 → в
    # рубле 100 копеек, 0 → в иене дробной части нет. Правится рядом с валютой,
    # потому что менять их порознь бессмысленно: валюта без своей размерности
    # превращает цены в мусор ровно в момент сохранения.
    currency_minor_units: int | None = None
    languages: list[str] | None = None
    is_active: bool | None = None
    # Город — переводимое поле, поэтому словарь: {"ru": "Москва"}. Появился
    # здесь вместе с группами-правилами: правило умеет резать флот по городу, а
    # задать его оператору было негде — признак существовал в базе и не
    # заполнялся ниоткуда, то есть правило по нему всегда возвращало пустоту.
    city: dict | None = None
    # Только владелец (партия 62-C). Пустой домен — убрать свой домен.
    subdomain: str | None = None
    custom_domain: str | None = None
    # Опасные правки, которые человек подтвердил в окне последствий.
    confirm: list[str] = []
    # Отключение через профиль — та же логика, что у /disable.
    reason: str | None = None
    enable_on: date | None = None


class DisableIn(Schema):
    reason: str
    enable_on: date | None = None

class AdminIn(Schema):
    email: str
    password: str | None = None


class AdminEmailIn(Schema):
    """
    Смена адреса администратора. Письма НЕ шлёт: она и нужна тогда, когда
    старый адрес недоступен.
    """

    current_email: str
    new_email: str

class ModuleSwitchIn(Schema):
    """Один модуль: включить или выключить (партия 62-E1)."""

    enabled: bool

class OffboardIn(Schema):
    reason: str = ""
    cancel: bool = False

class PurgeIn(Schema):
    # Поддомен вводят руками: галочку ставят не глядя, имя набирают, посмотрев.
    confirm_subdomain: str

class TemplateIn(Schema):
    code: str | None = None
    title: dict | None = None
    description: dict | None = None
    services: list[dict] | None = None
    modules: list[str] | None = None
    languages: list[str] | None = None
    preset: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None

class DictionaryEntryIn(Schema):
    kind: str
    code: str
    title: dict
    is_active: bool = True

class EnterHotelIn(Schema):
    reason: str
    ttl_minutes: int = 30

class NodeIn(Schema):
    name: str
    purpose: str = "grms"

class TeamInviteIn(Schema):
    email: str
    role: str = "support"
    full_name: str = ""

class TeamPatchIn(Schema):
    role: str | None = None
    is_active: bool | None = None

class BulkActiveIn(Schema):
    """
    Кого включаем/выключаем. ДВА СПОСОБА АДРЕСАЦИИ, а не два действия:
    перечислить отели или назвать группу.
    """

    hotel_ids: list[str] = []
    group_id: str | None = None
    is_active: bool
    # Отключение — с причиной (обязательна) и датой авто-включения (62-C).
    reason: str = ""
    enable_on: date | None = None


class DictionaryResetIn(Schema):
    hotel_ids: list[str]
    # Какие записи возвращать. Пусто — все: «вернуть отель к эталону целиком»
    # это отдельная задача от «вернуть одну запись».
    codes: list[str] = []


class PublicationIn(Schema):
    kind: str
    payload: dict = {}
    # Кому: перечень отелей, группа или весь флот. Вес действия разный, и право
    # проверяется по нему, а не по факту вызова ручки.
    scope: str = "hotels"
    group_id: str | None = None
    hotel_ids: list[str] = []


class GroupIn(Schema):
    """Группа: создание и правка. Код человек не вводит — он выводится из названия."""

    title: str | None = None
    description: str | None = None
    note: str | None = None
    color: str | None = None
    sort_order: int | None = None
    parent_id: str | None = None
    # Только при создании: отели, которые сразу переезжают в группу.
    hotel_ids: list[str] | None = None
    code: str | None = None


class GroupMembersIn(Schema):
    hotel_ids: list[str]


class GroupActionIn(Schema):
    """Действие по всей группе: `module_on` / `module_off` / `disable` / `enable`."""

    kind: str
    module: str | None = None
    # Только для выполнения: отели из показа «что изменится» — меняются ровно они.
    hotel_ids: list[str] = []
    reason: str = ""


class GroupDefaultsIn(Schema):
    enabled: bool
    modules: list[str] = []


class GroupMoveIn(Schema):
    """Перенести отели в группу; `group_id = null` — убрать из группы."""

    hotel_ids: list[str]
    group_id: str | None = None

class PlatformLoginIn(Schema):
    email: str
    password: str
    # Второй фактор. Приходит вторым шагом — первый отвечает `mfa_required`.
    totp_code: str | None = None

class PlatformRefreshIn(Schema):
    """Токен обновления консоли. Телом, а не заголовком: это обмен, не доступ."""

    refresh: str

class TotpEnableIn(Schema):
    code: str
