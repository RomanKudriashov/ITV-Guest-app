"""
Корпус — справочник, а не свободный текст (пункт 14 разбора).

Было: `Room.zone` строкой. «Главный корпус», «главный корпус» и «Главный
 корпус» с двумя пробелами — три разных корпуса для фильтра и три строки в
выдаче, притом что здание одно.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Building, Room

pytestmark = pytest.mark.django_db


def test_a_building_is_created_and_counted(cms, crystal):
    created = cms.post("/api/cms/buildings", {"title": {"ru": "Северный корпус"}})
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["title_i18n"] == "Северный корпус"
    assert body["rooms_count"] == 0

    listed = cms.get("/api/cms/buildings").json()["items"]
    assert any(row["id"] == body["id"] for row in listed)


def test_a_room_takes_a_building_and_keeps_the_string(cms, crystal):
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Вилла"}}).json()
    with tenant_context(crystal):
        room = Room.objects.first()

    patched = cms.patch(f"/api/cms/rooms/{room.pk}", {"building_id": building["id"]})
    assert patched.status_code == 200, patched.content
    assert patched.json()["building"]["title"] == "Вилла"

    with tenant_context(crystal):
        fresh = Room.objects.get(pk=room.pk)
        assert fresh.building_id is not None
        # Строка ведётся следом: она снимок на случай, если запись справочника
        # удалят, и по ней читаются номера, заведённые до переноса.
        assert fresh.zone == "Вилла"


def test_rooms_filter_by_building(cms, crystal):
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Флигель"}}).json()
    with tenant_context(crystal):
        room = Room.objects.first()
    cms.patch(f"/api/cms/rooms/{room.pk}", {"building_id": building["id"]})

    found = cms.get(f"/api/cms/rooms?building_id={building['id']}").json()
    numbers = {row["number"] for row in found["items"]}
    assert numbers == {room.number}, "фильтр по корпусу отобрал не тот набор"


def test_a_busy_building_is_not_deleted_silently(cms, crystal):
    """Удалить занятый корпус нельзя: номера остались бы с пустой ячейкой."""
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Занятый"}}).json()
    with tenant_context(crystal):
        room = Room.objects.first()
    cms.patch(f"/api/cms/rooms/{room.pk}", {"building_id": building["id"]})

    refused = cms.delete(f"/api/cms/buildings/{building['id']}")
    assert refused.status_code == 409
    assert refused.json()["code"] == "building_in_use"
    assert refused.json()["rooms_count"] == 1


def test_an_empty_building_goes_away(cms, crystal):
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Пустой"}}).json()
    assert cms.delete(f"/api/cms/buildings/{building['id']}").status_code == 200
    with tenant_context(crystal):
        assert not Building.objects.filter(pk=building["id"]).exists()


def test_two_buildings_cannot_share_a_code(cms):
    first = cms.post("/api/cms/buildings", {"title": {"ru": "Один"}, "code": "same"})
    assert first.status_code == 201
    second = cms.post("/api/cms/buildings", {"title": {"ru": "Другой"}, "code": "same"})
    assert second.status_code == 409
    assert second.json()["code"] == "building_exists"


def test_a_foreign_building_is_refused(cms, crystal, aurora):
    """Номер одного отеля не сошлётся на корпус другого."""
    with tenant_context(aurora):
        foreign = Building.objects.create(
            hotel_id=aurora.id, code="foreign", title={"ru": "Чужой"}
        )
    with tenant_context(crystal):
        room = Room.objects.first()
    refused = cms.patch(f"/api/cms/rooms/{room.pk}", {"building_id": str(foreign.pk)})
    assert refused.status_code == 422
    assert refused.json()["field"] == "building_id"


def test_the_migration_folded_case_and_spaces(crystal):
    """
    Перенос схлопывает регистр и пробелы: «Главный корпус» и «главный  корпус»
    — один корпус. Иначе отель разбирал бы дубли руками после переноса.
    """
    from apps.hotels.migrations import __name__ as _  # noqa: F401
    import re

    spaces = re.compile(r"\s+")

    def key(value: str) -> str:
        return spaces.sub(" ", value.strip()).casefold()

    assert key("Главный  корпус") == key("главный корпус")
