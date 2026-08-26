"""
Отель — корень тенанта, и всё, что описывает его физическую и организационную
структуру: бренд, языки, номера, точки исполнения, локации, расписания.

Hotel сам по себе НЕ тенант-таблица: он платформенного уровня и RLS на него не
вешается (иначе отель нельзя было бы даже найти по поддомену до того, как
установлен контекст). Изоляция отелей друг от друга обеспечивается тем, что
всё остальное ссылается на hotel_id и закрыто политиками.

Модели разложены по ресурсам, но импортируются по-прежнему из
`apps.hotels.models`: имя приложения, таблицы и политики RLS не менялись, и
десятки файлов, которые уже это пишут, не должны знать, в каком модуле лежит
класс.
"""

from __future__ import annotations

from .brand import BrandTheme
from .execution_point import ExecutionPoint
from .group import HotelGroup, HotelGroupMember
from .hotel import Hotel, HotelLanguage
from .location import Location
from .module import HotelModule
from .onprem import OnPremNode
from .platform import OnboardingTemplate, SystemDictionaryEntry
from .room import Room
from .schedule import Schedule, ScheduleAvailability, ScheduleInterval
from .service import Service
from .showcase import ShowcaseTile

__all__ = [
    "BrandTheme",
    "ExecutionPoint",
    "HotelGroup",
    "HotelGroupMember",
    "Hotel",
    "HotelLanguage",
    "HotelModule",
    "Location",
    "OnPremNode",
    "OnboardingTemplate",
    "Room",
    "Schedule",
    "ScheduleAvailability",
    "ScheduleInterval",
    "Service",
    "ShowcaseTile",
    "SystemDictionaryEntry",
]
