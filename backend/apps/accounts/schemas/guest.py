"""
Схемы гостевой сессии.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from datetime import datetime

from ninja import Schema

from apps.hotels.schemas.guest import HotelOut



class GuestSessionIn(Schema):
    room_number: str | None = None
    language: str | None = None

class GuestSessionOut(Schema):
    token: str | None = None
    session_id: str
    trust: str
    expires_at: datetime
    language: str
    room: str | None = None
    hotel: HotelOut

class RoomNotFoundOut(Schema):
    """Не ошибка сервера, а развилка сценария: ведём гостя на ручной ввод."""

    detail: str
    code: str = "room_not_found"
    hint: str = "manual_entry"
    hotel: HotelOut
