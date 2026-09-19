"""
Сторож стенда: проверки здоровья, а не только наполнения.

ЗАЧЕМ ОНИ ПОЯВИЛИСЬ. 19.09.2026 стенд прошёл проверку наполнения («стенд цел»)
в тот самый день, когда на нём не было службы расписания, ни одна комната не
была отнесена к категории, а на пульте висела точка от остатка прогонов.
Наполнение было в порядке — показывать было нельзя.

Здесь укусы на ту часть, которая проверяется данными. Службы (воркер, пульс,
коннектор) проверены вживую на стенде: гашением и отодвиганием отметки — в
наборе для них пришлось бы городить двойники брокера, и укус проверял бы
двойник, а не проверку.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.management.commands.check_demo_stand import Command
from apps.hotels.models import ExecutionPoint, Room, RoomCategory, Service

pytestmark = pytest.mark.django_db


@pytest.fixture
def command():
    return Command()


def test_missing_room_categories_are_a_problem(command, crystal):
    """Пустой справочник не ломает ничего заметного — он делает правило мёртвым."""
    with tenant_context(crystal):
        Room.objects.update(category=None)
        RoomCategory.objects.all().delete()
    problems = command._check_room_categories()
    assert any("НЕТ ни одной категории" in line for line in problems), problems


def test_rooms_without_a_category_are_a_problem(command, crystal):
    """Справочник есть, а номера к нему не отнесены — правило показа пустое."""
    with tenant_context(crystal):
        RoomCategory.objects.get_or_create(code="standard", defaults={"title": {"ru": "Стандарт"}})
        Room.objects.update(category=None)
    problems = command._check_room_categories()
    assert any("не отнесён к категории" in line for line in problems), problems


def test_marked_rooms_pass(command, crystal):
    with tenant_context(crystal):
        category, _ = RoomCategory.objects.get_or_create(
            code="standard", defaults={"title": {"ru": "Стандарт"}}
        )
        Room.objects.update(category=category)
    assert command._check_room_categories() == []


def test_a_point_without_a_live_venue_is_a_ghost_on_the_board(command, crystal):
    """
    Пульт считает по точкам исполнения: удалили заведение — очередь осталась,
    и строка на пульте осталась вместе с ней (пункт 37 бэклога).
    """
    with tenant_context(crystal):
        service = Service.objects.first()
        point_code = service.execution_point.code
        service.delete()
    problems = command._check_orphan_points()
    assert any(point_code in line for line in problems), problems


def test_every_point_has_its_venue_by_default(command, crystal):
    assert command._check_orphan_points() == []


def test_a_hotel_without_coordinates_has_no_weather(command, crystal):
    """Нет города — блока погоды у гостя не будет вовсе, и это не видно глазами."""
    crystal.latitude = None
    crystal.longitude = None
    crystal.save(update_fields=["latitude", "longitude", "updated_at"])
    problems = command._check_weather([])
    assert any("город не выбран" in line for line in problems), problems


def test_migrations_are_applied_in_the_test_database(command):
    """Обратная сторона: на здоровой базе проверка молчит, а не шумит."""
    assert command._check_migrations() == []


def test_an_inactive_point_is_not_a_ghost(command, crystal):
    """Выключенная очередь с пульта уже ушла — её отсутствие сервиса не беда."""
    with tenant_context(crystal):
        point = ExecutionPoint.objects.create(hotel_id=crystal.id, code="ghost", title={"ru": "Призрак"})
        point.is_active = False
        point.save(update_fields=["is_active", "updated_at"])
    assert command._check_orphan_points() == []
