"""
ПРАВКА НОМЕРНОГО ФОНДА ИЗ CONTROL (партия 63-1) — поверх сервисов панели.

Укусы:
* добавление диапазоном: «201-203» заводит три номера, дубль пропускается,
  удалённый номер возвращается с историей — или заводится заново;
* удаление номера снимает PIN, отзывает сессии гостей (и закрывает их сокеты),
  отвязывает вариант; выезд в панели тоже снимает PIN;
* корпус пачкой в панели применяется;
* «только чтение» в Control — 403 на каждую правку, чтение — можно;
* PIN 401: «есть PIN» — одно правило на схему, таблицу и «Доступ» панели;
* правка из Control видна в панели отеля и наоборот;
* корпус с номерами удаляется только с переносом; переименование корпуса
  ведёт за собой строку у номеров;
* правки Control — в «Истории» отеля и в истории номера.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Building, Room

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root63@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


def _platform(client, email: str, password: str):
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kwargs)
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


@pytest.fixture
def api(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    return _platform(client, PLATFORM_EMAIL, PLATFORM_PASSWORD)


def _room(hotel, number: str) -> Room:
    with tenant_context(hotel):
        return Room.objects.get(number=number)


def _map_room(api, hotel, number: str) -> dict:
    data = api("get", f"/hotels/{hotel.pk}/rooms/map?search={number}").json()
    return next(r for b in data["buildings"] for f in b["floors"] for r in f["rooms"] if r["number"] == number)


def _module_on(hotel):
    from apps.hotels.models import HotelModule

    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True})


# ── Добавление ────────────────────────────────────────────────────────────


def test_bite_range_duplicate_and_restore(api, crystal):
    preview = api("post", f"/hotels/{crystal.pk}/rooms/bulk/preview", {"spec": "9201-9203, 201"}).json()
    assert preview["will_create"] == ["9201", "9202", "9203"]
    assert preview["exists"] == ["201"]

    made = api("post", f"/hotels/{crystal.pk}/rooms/bulk", {"spec": "9201-9203, 201", "floor": "92"})
    assert made.status_code == 200, made.content
    assert made.json()["created"] == ["9201", "9202", "9203"]
    assert made.json()["skipped"] == ["201"]
    with tenant_context(crystal):
        assert Room.objects.filter(number__in=["9201", "9202", "9203"], floor="92").count() == 3

    # Лимит — до создания и на весь список.
    too_many = api("post", f"/hotels/{crystal.pk}/rooms/bulk/preview", {"spec": "1-501"})
    assert too_many.status_code == 422 and "500" in too_many.json()["detail"]

    # Удалили — при повторном добавлении номер ВОЗВРАЩАЕТСЯ той же строкой.
    room = _room(crystal, "9201")
    assert api("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}").status_code == 200
    preview = api("post", f"/hotels/{crystal.pk}/rooms/bulk/preview", {"spec": "9201"}).json()
    assert preview["will_restore"] == ["9201"]
    back = api("post", f"/hotels/{crystal.pk}/rooms/bulk", {"spec": "9201"}).json()
    assert back["restored"] == ["9201"]
    assert _room(crystal, "9201").pk == room.pk

    # «Завести заново»: новая строка, удалённая — в архиве под другим именем.
    api("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}")
    fresh = api("post", f"/hotels/{crystal.pk}/rooms/bulk", {"spec": "9201", "restore": False}).json()
    assert fresh["created"] == ["9201"] and fresh["restored"] == []
    assert _room(crystal, "9201").pk != room.pk
    with tenant_context(crystal):
        archived = Room.all_objects.get(pk=room.pk)
    assert archived.deleted_at is not None and archived.number != "9201"


# ── Удаление и выезд ──────────────────────────────────────────────────────


def _guest_session(hotel, room):
    from apps.accounts.models import GuestSession

    with tenant_context(hotel):
        return GuestSession.objects.create(room=room, expires_at=timezone.now() + timedelta(hours=6))


def test_bite_delete_drops_pin_sessions_variant_and_sockets(api, crystal, monkeypatch):
    from apps.accounts.models import GuestSession
    from apps.grms.models import RoomPin, RoomType, RoomTypeRoom
    from apps.grms.services import pin as room_pin
    from apps.realtime import sessions as realtime

    closed: list = []
    monkeypatch.setattr(realtime, "close_sockets", lambda groups: closed.extend(groups))
    room = _room(crystal, "201")
    room_pin.set_pin(crystal, room, pin="4321")
    session = _guest_session(crystal, room)
    with tenant_context(crystal):
        room_type = RoomType.objects.first() or RoomType.objects.create(code="t63", title={"ru": "Тип"})
        RoomTypeRoom.objects.update_or_create(room=room, defaults={"room_type": room_type})

    impact = api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/delete-check").json()
    assert impact["pin"] is True and impact["sessions"] == 1 and impact["variant"]

    assert api("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}").status_code == 200
    with tenant_context(crystal):
        assert not RoomPin.all_objects.filter(room_id=room.pk).exists()
        assert GuestSession.objects.get(pk=session.pk).revoked_at is not None
        assert not RoomTypeRoom.objects.filter(room_id=room.pk).exists()
        assert Room.objects.filter(pk=room.pk).count() == 0
    assert realtime.guest_session_group(session.pk) in closed


def test_bite_checkout_in_panel_drops_pin(cms, crystal, monkeypatch):
    from apps.grms.models import RoomPin
    from apps.grms.services import pin as room_pin
    from apps.realtime import sessions as realtime

    closed: list = []
    monkeypatch.setattr(realtime, "close_sockets", lambda groups: closed.extend(groups))
    room = _room(crystal, "205")
    room_pin.set_pin(crystal, room, pin="5555")
    session = _guest_session(crystal, room)
    result = cms.post(f"/api/cms/rooms/{room.pk}/checkout", {}).json()
    assert result["revoked"] == 1 and result["pin_cleared"] is True
    with tenant_context(crystal):
        assert not RoomPin.all_objects.filter(room_id=room.pk).exists()
    assert realtime.guest_session_group(session.pk) in closed


def test_bite_bulk_building_applies_in_panel(cms, crystal):
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Пачка"}}).json()
    rooms = [_room(crystal, n) for n in ("301", "305")]
    done = cms.post(
        "/api/cms/rooms/bulk-update",
        {"selection": {"ids": [str(r.pk) for r in rooms]}, "patch": {"building_id": building["id"]}},
    ).json()
    assert done == {"matched": 2, "changed": 2}
    with tenant_context(crystal):
        for room in rooms:
            fresh = Room.objects.get(pk=room.pk)
            assert str(fresh.building_id) == building["id"] and fresh.zone == "Пачка"


# ── Права ─────────────────────────────────────────────────────────────────


def test_bite_read_only_gets_403_on_every_write(api, client, crystal):
    invited = api("post", "/team", {"email": "ro63@platform.test", "role": "read_only"}).json()
    ro = _platform(client, "ro63@platform.test", invited["password"])
    room = _room(crystal, "312")
    building = _room(crystal, "201").building_id
    assert ro("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/detail").status_code == 200
    assert ro("get", f"/hotels/{crystal.pk}/rooms/dictionaries").status_code == 200
    writes = [
        ("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"floor": "9"}),
        ("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}", None),
        ("post", f"/hotels/{crystal.pk}/rooms/bulk", {"spec": "9999"}),
        ("post", f"/hotels/{crystal.pk}/rooms/{room.pk}/pin", {"generate": True}),
        ("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}/pin", None),
        ("post", f"/hotels/{crystal.pk}/buildings", {"title": {"ru": "Нет"}}),
        ("patch", f"/hotels/{crystal.pk}/buildings/{building}", {"title": {"ru": "Нет"}}),
        ("delete", f"/hotels/{crystal.pk}/room-categories/{building}", None),
        ("put", f"/hotels/{crystal.pk}/rooms/rule", {"floor_digits": 1, "position_digits": 2}),
    ]
    for method, path, body in writes:
        assert ro(method, path, body).status_code == 403, (method, path)
    assert _room(crystal, "312").floor == room.floor


# ── PIN 401: одно правило ─────────────────────────────────────────────────


def test_bite_pin_401_one_rule_everywhere(api, crystal):
    from apps.grms.models import RoomPin
    from apps.grms.services import access, pin as room_pin

    _module_on(crystal)
    room = _room(crystal, "401")
    room_pin.set_pin(crystal, room, pin="4011")
    assert _map_room(api, crystal, "401")["pin"] is True
    # Истёкший PIN — «нет» везде: схема, прежняя таблица, «Доступ» панели.
    with tenant_context(crystal):
        RoomPin.objects.filter(room=room).update(valid_until=timezone.now() - timedelta(minutes=1))
    assert _map_room(api, crystal, "401")["pin"] is False
    old = api("get", f"/hotels/{crystal.pk}/rooms?search=401").json()["items"]
    assert [r["pin"] for r in old if r["number"] == "401"] == [False]
    assert api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/detail").json()["pin"]["expired"] is True
    with tenant_context(crystal):
        assert room.pk not in access.active_pin_room_ids()


# История читается через соединение `platform` — оно видит только
# зафиксированное, поэтому тестам с историей нужна настоящая транзакция.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_pin_generate_shows_code_once_and_is_logged(api, crystal):
    _module_on(crystal)
    room = _room(crystal, "412")
    issued = api("post", f"/hotels/{crystal.pk}/rooms/{room.pk}/pin", {"generate": True, "valid_until": "2030-01-31"}).json()
    assert issued["has"] is True and issued["pin"].isdigit() and len(issued["pin"]) == 6
    assert issued["valid_until"].startswith("2030-01-31")
    detail = api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/detail").json()
    # Карточка номера говорит «есть», но самого кода не отдаёт.
    assert detail["pin"]["has"] is True and set(detail["pin"]) == {"has", "valid_until", "issued_at", "expired"}
    assert api("delete", f"/hotels/{crystal.pk}/rooms/{room.pk}/pin").json() == {"has": False}
    actions = [i["action"] for i in api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/history").json()["items"]]
    assert actions[:2] == ["grms.pin_cleared", "grms.pin_set"]
    # Сам код в журнал не попадает.
    history = json.dumps(api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/history").json())
    assert issued["pin"] not in history


# ── Control ↔ панель ──────────────────────────────────────────────────────


# История читается через соединение `platform` — оно видит только
# зафиксированное, поэтому тестам с историей нужна настоящая транзакция.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_control_edit_seen_in_panel_and_back(api, cms, crystal):
    room = _room(crystal, "212")
    category = cms.post("/api/cms/room-categories", {"title": {"ru": "Мансарда"}}).json()
    done = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"floor": "21", "category_id": category["id"], "out_of_service": True})
    assert done.status_code == 200, done.content
    panel = next(r for r in cms.get("/api/cms/rooms?search=212").json()["items"] if r["number"] == "212")
    assert panel["floor"] == "21" and panel["category_id"] == category["id"] and panel["out_of_service"] is True

    cms.patch(f"/api/cms/rooms/{room.pk}", {"floor": "2", "out_of_service": False})
    detail = api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/detail").json()
    assert detail["floor"] == "2" and detail["out_of_service"] is False
    assert _map_room(api, crystal, "212")["floor"] == "2"

    # «История» отеля — правка Control есть, правки панели нет.
    hotel_history = api("get", f"/hotels/{crystal.pk}/history?what=rooms").json()["items"]
    updates = [i for i in hotel_history if i["action"] == "room.updated"]
    assert len(updates) == 1
    fields = {c["field"] for c in updates[0]["changes"]}
    assert {"room_floor", "room_category", "room_out_of_service"} <= fields
    # История номера — обе.
    room_history = [i["action"] for i in api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/history").json()["items"]]
    assert room_history.count("room.updated") == 2


def test_rename_needs_confirmation_from_control(api, crystal):
    room = _room(crystal, "312")
    refused = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"number": "3120"})
    assert refused.status_code == 409 and refused.json()["code"] == "rename_needs_confirmation"
    check = api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/rename-check?number=3120").json()
    assert check["new_number"] == "3120"
    done = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"number": "3120", "confirm_rename": True})
    assert done.status_code == 200 and done.json()["number"] == "3120"


def test_variant_and_device_from_control(api, crystal):
    from apps.grms.models import RoomType

    room = _room(crystal, "405")
    with tenant_context(crystal):
        code = (RoomType.objects.first() or RoomType.objects.create(code="t63", title={"ru": "Тип"}, device_name_template="R{room}")).code
    no_variant = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"variant": "", "device_name": "X"})
    assert no_variant.status_code == 422
    set_variant = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"variant": code}).json()
    assert set_variant["variant"]["code"] == code
    named = api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"device_name": "Room-405-B"}).json()
    assert named["device"]["override"] == "Room-405-B" and named["device"]["effective"] == "Room-405-B"
    assert api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"variant": "nope"}).status_code == 404


# ── Корпуса и категории ───────────────────────────────────────────────────


# История читается через соединение `platform` — оно видит только
# зафиксированное, поэтому тестам с историей нужна настоящая транзакция.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_building_rename_per_language_and_delete_with_move(api, crystal):
    made = api("post", f"/hotels/{crystal.pk}/buildings", {"title": {"ru": "Северный", "en": "North"}})
    assert made.status_code == 201
    building = made.json()
    room = _room(crystal, "301")
    api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"building_id": building["id"]})

    renamed = api("patch", f"/hotels/{crystal.pk}/buildings/{building['id']}", {"title": {"ru": "Полярный", "en": "Polar"}}).json()
    assert renamed["title"] == {"ru": "Полярный", "en": "Polar"}
    assert _room(crystal, "301").zone == "Полярный", "строка корпуса у номера не пошла за переименованием"

    busy = api("delete", f"/hotels/{crystal.pk}/buildings/{building['id']}")
    assert busy.status_code == 409 and busy.json()["code"] == "building_in_use"
    target = api("post", f"/hotels/{crystal.pk}/buildings", {"title": {"ru": "Южный"}}).json()
    moved = api("delete", f"/hotels/{crystal.pk}/buildings/{building['id']}?move_to={target['id']}").json()
    assert moved == {"ok": True, "moved": 1}
    fresh = _room(crystal, "301")
    assert str(fresh.building_id) == target["id"] and fresh.zone == "Южный"
    with tenant_context(crystal):
        assert not Building.objects.filter(pk=building["id"]).exists()

    actions = [i["action"] for i in api("get", f"/hotels/{crystal.pk}/history?what=rooms").json()["items"]]
    assert {"building.created", "building.updated", "building.deleted"} <= set(actions)


def test_category_delete_to_none(api, crystal):
    category = api("post", f"/hotels/{crystal.pk}/room-categories", {"title": {"ru": "Временная"}}).json()
    room = _room(crystal, "305")
    api("patch", f"/hotels/{crystal.pk}/rooms/{room.pk}", {"category_id": category["id"]})
    gone = api("delete", f"/hotels/{crystal.pk}/room-categories/{category['id']}?move_to=none").json()
    assert gone == {"ok": True, "moved": 1}
    assert _room(crystal, "305").category_id is None


def test_dictionaries_and_detail_shape(api, crystal):
    data = api("get", f"/hotels/{crystal.pk}/rooms/dictionaries").json()
    assert {"buildings", "categories", "variants", "languages", "room_control"} <= set(data)
    room = _room(crystal, "201")
    detail = api("get", f"/hotels/{crystal.pk}/rooms/{room.pk}/detail").json()
    assert detail["number"] == "201" and detail["rule_position"] == "01"
    assert api("get", f"/hotels/{crystal.pk}/rooms/not-a-uuid/detail").status_code == 404
