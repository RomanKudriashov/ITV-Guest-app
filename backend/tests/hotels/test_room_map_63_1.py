"""
СХЕМА НОМЕРНОГО ФОНДА (партия 63-1) — правило «как читать номер» и выдача.

Укусы:
* «2205» по правилу по умолчанию — этаж 22, позиция 05; с «этаж — первая
  цифра» — этаж 2;
* «3А» — этажа в номере нет, позиция «3А» (буква остаётся у позиции);
* позиция, заданная руками, сильнее правила; этаж, заданный у номера, —
  тоже;
* номер без корпуса попадает в «без корпуса», а не теряется;
* готовность управления — из настроек: без связи / варианта / PIN —
  «мешает гостю», демо-вход без PIN — «требует внимания»;
* сводка «Что исправить» не худеет от фильтра;
* правило и ручная позиция пишутся в «Историю» отеля.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.services.room_numbers import DEFAULT_RULE, read_number

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


@pytest.fixture
def api(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kwargs)
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


def _hotel(subdomain: str) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(subdomain=subdomain, name=subdomain.title(), admin_email=f"admin@{subdomain}.test").hotel


def _rooms(hotel: Hotel, *specs):
    """specs: (номер, этаж, корпус-строкой) — корпус пустой = без корпуса."""
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return [Room.objects.create(number=number, floor=floor, zone=zone) for number, floor, zone in specs]


def _flat(data: dict) -> dict[str, dict]:
    return {r["number"]: r for b in data["buildings"] for f in b["floors"] for r in f["rooms"]}


# ── Правило ───────────────────────────────────────────────────────────────


def test_bite_rule_reads_2205_and_3a():
    assert read_number("2205", DEFAULT_RULE) == ("22", "05")
    assert read_number("2205", {"floor_digits": 1, "position_digits": 2}) == ("2", "05")
    assert read_number("3А", DEFAULT_RULE) == ("", "3А")
    assert read_number("203А", DEFAULT_RULE) == ("2", "03А")
    assert read_number("Вилла-12", DEFAULT_RULE) == ("", "12")
    assert read_number("0105", DEFAULT_RULE) == ("1", "05")
    assert read_number("люкс", DEFAULT_RULE) == ("", "")


def test_bite_map_floor_from_rule_only_when_room_floor_empty(api):
    hotel = _hotel("map-rule")
    _rooms(hotel, ("2205", "", ""), ("2207", "7", ""), ("3А", "", ""))
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    rooms = _flat(data)
    assert (rooms["2205"]["floor"], rooms["2205"]["floor_source"]) == ("22", "rule")
    # Этаж, заданный у номера, сильнее правила.
    assert (rooms["2207"]["floor"], rooms["2207"]["floor_source"]) == ("7", "room")
    assert (rooms["3А"]["floor"], rooms["3А"]["floor_source"], rooms["3А"]["position"]) == ("", "none", "3А")
    assert data["summary"]["rule_floors"] == 1

    resp = api("put", f"/hotels/{hotel.pk}/rooms/rule", {"floor_digits": 1, "position_digits": 2})
    assert resp.status_code == 200 and resp.json()["is_default"] is False
    assert _flat(api("get", f"/hotels/{hotel.pk}/rooms/map").json())["2205"]["floor"] == "2"
    # Кривое правило — 422, сохранённое не тронуто.
    assert api("put", f"/hotels/{hotel.pk}/rooms/rule", {"floor_digits": 1, "position_digits": 0}).status_code == 422
    assert api("get", f"/hotels/{hotel.pk}/rooms/map").json()["rule"]["floor_digits"] == 1


def test_bite_manual_position_beats_rule_and_returns_to_rule(api):
    hotel = _hotel("map-place")
    room, _ = _rooms(hotel, ("512", "", ""), ("410", "", ""))
    resp = api("put", f"/hotels/{hotel.pk}/rooms/{room.pk}/place", {"position": "10"})
    assert resp.json() == {"id": str(room.pk), "number": "512", "position": "10", "position_source": "manual"}
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    assert (_flat(data)["512"]["position"], _flat(data)["512"]["position_source"]) == ("10", "manual")
    # Встал над 410: одна позиция в здании, а не две.
    assert data["buildings"][0]["positions"] == ["10"]
    assert data["summary"]["manual_positions"] == 1

    back = api("put", f"/hotels/{hotel.pk}/rooms/{room.pk}/place", {"position": ""}).json()
    assert (back["position"], back["position_source"]) == ("12", "rule")
    assert api("put", f"/hotels/{hotel.pk}/rooms/not-a-uuid/place", {"position": "1"}).status_code == 404


def test_bite_room_without_building_is_kept_and_last(api):
    hotel = _hotel("map-nobld")
    _rooms(hotel, ("101", "1", "Корпус Б"), ("102", "1", ""), ("201", "2", "Корпус А"))
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    assert [b["title"] for b in data["buildings"]] == ["Корпус А", "Корпус Б", ""]
    assert data["buildings"][-1]["key"] == "" and data["buildings"][-1]["rooms"] == 1
    assert {f["value"] for f in data["facets"]["building"]} >= {"none"}
    only = api("get", f"/hotels/{hotel.pk}/rooms/map?building=none").json()
    assert list(_flat(only)) == ["102"]


def test_floors_top_down_and_positions_natural(api):
    hotel = _hotel("map-order")
    _rooms(hotel, ("110", "", ""), ("102", "", ""), ("1002", "", ""), ("203", "", ""))
    building = api("get", f"/hotels/{hotel.pk}/rooms/map").json()["buildings"][0]
    assert [f["floor"] for f in building["floors"]] == ["10", "2", "1"]
    assert building["positions"] == ["02", "03", "10"]


# ── Готовность управления ─────────────────────────────────────────────────


def _room_control(hotel: Hotel, demo: bool = False):
    from apps.hotels.models import HotelModule

    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True, "config": {"guest_entry_demo": demo}})


def test_control_off_without_module(api):
    hotel = _hotel("map-off")
    _rooms(hotel, ("101", "1", ""))
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    assert data["room_control"] is False
    assert _flat(data)["101"]["control"] == "off" and _flat(data)["101"]["problems"] == []


def test_bite_control_blocked_and_attention(api):
    from apps.grms.models import PublishedConfig, RoomType, RoomTypeRoom

    hotel = _hotel("map-ready")
    _room_control(hotel)
    bare, typed, draft = _rooms(hotel, ("101", "1", ""), ("102", "1", ""), ("103", "1", ""))
    with tenant_context(hotel):
        ready = RoomType.objects.create(code="std", title={"ru": "Стандарт"})
        unpublished = RoomType.objects.create(code="lux", title={"ru": "Люкс"})
        PublishedConfig.objects.create(room_type=ready, version=1, is_current=True)
        RoomTypeRoom.objects.create(room=typed, room_type=ready)
        RoomTypeRoom.objects.create(room=draft, room_type=unpublished)
    rooms = _flat(api("get", f"/hotels/{hotel.pk}/rooms/map").json())
    # Узлов нет — связи нет у всех; PIN нет и демо-входа нет — мешает.
    assert rooms["101"]["problems"] == ["no_link", "no_variant", "no_pin"]
    assert rooms["102"]["problems"] == ["no_link", "no_pin"]
    assert rooms["103"]["problems"] == ["no_link", "not_published", "no_pin"]
    assert {r["control"] for r in rooms.values()} == {"blocked"}

    _room_control(hotel, demo=True)
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    assert _flat(data)["102"]["problems"] == ["no_link", "demo_entry"]
    # Сводка — по всем номерам, фильтр её не трогает.
    filtered = api("get", f"/hotels/{hotel.pk}/rooms/map?problem=no_variant").json()
    assert list(_flat(filtered)) == ["101"]
    assert filtered["summary"] == data["summary"]
    assert data["summary"]["problems"]["no_variant"] == 1 and data["summary"]["problems"]["demo_entry"] == 3


def test_map_sort_and_bad_sort(api):
    hotel = _hotel("map-sort")
    _rooms(hotel, ("10", "", ""), ("2", "", ""), ("3А", "", ""))
    order = api("get", f"/hotels/{hotel.pk}/rooms/map?sort=number&dir=asc").json()
    numbers = {r["id"]: r["number"] for r in _flat(order).values()}
    assert [numbers[i] for i in order["order"]] == ["2", "3А", "10"]
    bad = api("get", f"/hotels/{hotel.pk}/rooms/map?sort=guest")
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_sort"


def test_rule_and_place_land_in_history(api):
    hotel = _hotel("map-history")
    (room,) = _rooms(hotel, ("2205", "", ""))
    api("put", f"/hotels/{hotel.pk}/rooms/rule", {"floor_digits": 1, "position_digits": 2})
    api("put", f"/hotels/{hotel.pk}/rooms/{room.pk}/place", {"position": "7"})
    # Повтор того же — без записи.
    api("put", f"/hotels/{hotel.pk}/rooms/rule", {"floor_digits": 1, "position_digits": 2})
    items = api("get", f"/hotels/{hotel.pk}/history?what=rooms").json()["items"]
    actions = sorted(i["action"] for i in items)
    assert actions == ["platform.hotel.room_place_set", "platform.hotel.rooms_rule_set"]
    place = next(i for i in items if i["action"] == "platform.hotel.room_place_set")
    assert place["object"] == {"kind": "room", "number": "2205"}
    assert place["changes"] == [{"field": "room_position", "from": "", "to": "7"}]
    rule = next(i for i in items if i["action"] == "platform.hotel.rooms_rule_set")
    assert rule["changes"] == [{"field": "room_floor_digits", "from": 0, "to": 1}]
