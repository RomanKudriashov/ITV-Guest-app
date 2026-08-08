"""
Схемы входа, сотрудников и привязок — CMS.

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



class LoginIn(Schema):
    email: str
    password: str

class StaffUserOut(Schema):
    id: str
    email: str
    full_name: str
    language: str
    is_hotel_admin: bool
    is_platform_admin: bool
    # Роль внутри отеля: line_staff | service_manager | hotel_admin.
    role: str = "line_staff"
    has_cms_access: bool = False
    managed_point_ids: list[str] = []
    member_point_ids: list[str] = []

class LoginOut(Schema):
    access: str
    refresh: str
    user: StaffUserOut
    # Тема приходит уже со входом, а не отдельным запросом следом: иначе первый
    # кадр после логина сотрудник видит в платформенных цветах, и только потом
    # экран перекрашивается в бренд отеля.
    theme: dict[str, Any] = {}

class MeOut(Schema):
    user: StaffUserOut
    hotel: dict[str, Any]
    # Токены бренда отеля. Лежат здесь, а не в отдельном эндпоинте, потому что
    # `/auth/me` — единственный вызов, который делает КАЖДАЯ поверхность
    # персонала (CMS, трекер). Пока темы тут не было, CMS и трекер работали на
    # платформенном дефолте: белые, с чужим акцентом, и отель видел не свой
    # бренд в собственной админке.
    theme: dict[str, Any]

class BootstrapOut(Schema):
    hotel: dict[str, Any]
    languages: list[dict[str, Any]]
    flags: list[dict[str, Any]]
    allergens: list[dict[str, Any]]
    schedules: list[dict[str, Any]]
    execution_points: list[dict[str, Any]]
    day_parts: list[str]

class AssignmentIn(Schema):
    execution_point_id: str
    level: str = "member"

class StaffIn(Schema):
    email: str
    full_name: str = ""
    password: str
    language: str = ""
    is_hotel_admin: bool = False
    assignments: list[AssignmentIn] = []

class StaffPatch(Schema):
    email: str | None = None
    full_name: str | None = None
    password: str | None = None
    language: str | None = None
    is_hotel_admin: bool | None = None
    is_active: bool | None = None
    assignments: list[AssignmentIn] | None = None

class AssignmentsIn(Schema):
    assignments: list[AssignmentIn]
