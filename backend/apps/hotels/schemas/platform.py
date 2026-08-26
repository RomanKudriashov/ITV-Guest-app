"""
Схемы платформенной консоли: флот, тарифы, команда.

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
    # Тарифа здесь НЕТ намеренно. У него одна дверь — PUT /hotels/{id}/tariff,
    # и она заперта на владельца. Пока поле лежало ещё и тут (и в ModulesIn),
    # охрана стояла на двери, а рядом было две дыры в стене: тариф менялся
    # ролью «только чтение» через профиль и через реестр модулей.
    name: str | None = None
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

class ModuleEntryIn(Schema):
    code: str
    is_enabled: bool = False
    source: str = "tariff"
    config: dict = {}

class ModulesIn(Schema):
    # Без тарифа: см. HotelPatchIn. Реестр модулей — операционная настройка,
    # тариф — денежная, и одна ручка на двоих делала вторую необязательной.
    modules: list[ModuleEntryIn] = []

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
    tariff: str | None = None
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

class TariffIn(Schema):
    tariff: str
    started_on: date | None = None
    trial_ends_at: date | None = None
    # Осознанное подтверждение понижения ниже использования.
    acknowledge_downgrade: bool = False

class BulkActiveIn(Schema):
    """
    Кого включаем/выключаем. ДВА СПОСОБА АДРЕСАЦИИ, а не два действия:
    перечислить отели или назвать группу. У группы-правила состав считается в
    момент нажатия — тем же кодом, что показал число на предпросмотре.
    """

    hotel_ids: list[str] = []
    group_id: str | None = None
    is_active: bool


class DictionaryResetIn(Schema):
    hotel_ids: list[str]
    # Какие записи возвращать. Пусто — все: «вернуть отель к эталону целиком»
    # это отдельная задача от «вернуть одну запись».
    codes: list[str] = []


class GroupIn(Schema):
    code: str | None = None
    title: str | None = None
    kind: str | None = None
    mode: str | None = None
    # Условие для `mode=rule`: {"city": "Москва"}. Неизвестные ключи сервис
    # отбрасывает — правило по несуществующему признаку не выдаёт пустоту молча.
    rule: dict | None = None
    note: str | None = None


class GroupMembersIn(Schema):
    hotel_ids: list[str]

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
