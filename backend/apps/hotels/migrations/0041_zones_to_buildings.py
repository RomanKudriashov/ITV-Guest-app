"""
Строки `Room.zone` → записи справочника корпусов.

ПЕРЕНОС, А НЕ СТИРАНИЕ. У номеров уже лежали строки, и это единственное, что о
корпусе известно. Каждое РАЗНОЕ непустое значение становится записью
справочника; номер получает ссылку, строка остаётся на месте как снимок.

Сравнение по СХЛОПНУТЫМ ПРОБЕЛАМ и регистру: «Главный корпус», «главный
корпус» и «Главный  корпус» — один корпус, и отель не должен разбирать это
руками после переноса.

Отдельной миграцией от схемы: AddField и RunPython в одной упираются в
«pending trigger events».
"""

from __future__ import annotations

import re

from django.db import migrations
from django.utils.text import slugify

_SPACES = re.compile(r"\s+")


def _key(value: str) -> str:
    return _SPACES.sub(" ", (value or "").strip()).casefold()


def forwards(apps_registry, schema_editor):
    Room = apps_registry.get_model("hotels", "Room")
    Building = apps_registry.get_model("hotels", "Building")
    alias = schema_editor.connection.alias

    # `_base_manager`: мягко удалённые номера тоже помнят свой корпус, и
    # восстановленный номер не должен остаться без ссылки.
    rooms = Room._base_manager.using(alias).exclude(zone="").exclude(zone=None)
    by_hotel: dict = {}
    for room in rooms:
        by_hotel.setdefault(room.hotel_id, {}).setdefault(_key(room.zone), room.zone)

    moved = 0
    for hotel_id, zones in by_hotel.items():
        for order, (key, title) in enumerate(sorted(zones.items())):
            code = slugify(title) or f"building-{order + 1}"
            building = (
                Building._base_manager.using(alias)
                .filter(hotel_id=hotel_id, code=code)
                .first()
            )
            if building is None:
                building = Building._base_manager.using(alias).create(
                    hotel_id=hotel_id,
                    code=code,
                    title={"ru": title},
                    sort_order=order,
                    is_active=True,
                )
            for room in rooms.filter(hotel_id=hotel_id):
                if _key(room.zone) == key and room.building_id is None:
                    Room._base_manager.using(alias).filter(pk=room.pk).update(
                        building_id=building.pk
                    )
                    moved += 1

    if moved:
        print(f"    номеров привязано к корпусам: {moved}")


def backwards(apps_registry, schema_editor):
    """Ссылки снимаем, строки не трогаем — они и есть дорога назад."""
    Room = apps_registry.get_model("hotels", "Room")
    Room._base_manager.using(schema_editor.connection.alias).update(building=None)


class Migration(migrations.Migration):
    dependencies = [("hotels", "0040_buildings")]

    operations = [migrations.RunPython(forwards, backwards)]
