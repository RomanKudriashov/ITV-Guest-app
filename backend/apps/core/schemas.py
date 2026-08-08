"""
Общие схемы: то, что не принадлежит ни одному домену.

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

# Переводимое поле в теле запроса/ответа: {код языка: строка}. Псевдоним живёт
# здесь, потому что им пользуются схемы всех доменов.
Translations = dict[str, str]



class ErrorOut(Schema):
    detail: str
    code: str = "error"
    field: str | None = None

class OkOut(Schema):
    ok: bool = True

class ReorderEntry(Schema):
    id: str
    sort_order: int
    parent_id: str | None = None

class ReorderIn(Schema):
    items: list[ReorderEntry]

class ItemsReorderIn(Schema):
    category_id: str
    items: list[ReorderEntry]

class ToggleIn(Schema):
    is_active: bool
