"""
ДЕЙСТВИЯ НАД МНОГИМИ НОМЕРАМИ (партия 63-2) — показ, потом выполнение.

Укусы:
* выполняется только показанное: номер, дописанный в запрос после показа, не
  трогается;
* одна транзакция: ошибка на одном номере — не меняется ничего;
* выданные PIN не попадают ни в журнал, ни в логи;
* «только чтение» — 403 на показ и выполнение;
* больше 500 номеров — отказ до всякой работы.
"""

from __future__ import annotations

import json
import logging

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Room

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root632@platform.test"
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


def _ids(hotel, *numbers) -> list[str]:
    with tenant_context(hotel):
        rows = {r.number: str(r.pk) for r in Room.objects.filter(number__in=numbers)}
    return [rows[n] for n in numbers]


def _room(hotel, number: str) -> Room:
    with tenant_context(hotel):
        return Room.objects.get(number=number)


def _module_on(hotel):
    from apps.hotels.models import HotelModule

    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True})


def _preview(api, hotel, action, value, ids):
    resp = api("post", f"/hotels/{hotel.pk}/rooms/batch/preview", {"action": action, "value": value, "room_ids": ids})
    assert resp.status_code == 200, resp.content
    return resp.json()


def _run(api, hotel, ticket, ids):
    return api("post", f"/hotels/{hotel.pk}/rooms/batch", {"ticket": ticket, "room_ids": ids})


def test_preview_says_change_same_refused(api, crystal):
    ids = _ids(crystal, "201", "205")
    with tenant_context(crystal):
        Room.objects.filter(number="205").update(out_of_service=True)
    shown = _preview(api, crystal, "out_of_service", True, ids)
    outcomes = {r["number"]: r["outcome"] for r in shown["rows"]}
    assert outcomes == {"201": "change", "205": "same"}
    assert shown["summary"]["change"] == 1 and shown["summary"]["same"] == 1
    # Срок PIN у номера без PIN — «нельзя», с причиной.
    _module_on(crystal)
    until = _preview(api, crystal, "pin_until", "2031-01-01", ids)
    assert {r["outcome"] for r in until["rows"]} == {"refused"} and until["rows"][0]["reason"] == "no_pin"
    assert until["ticket"] is None


def test_bite_only_shown_rooms_change(api, crystal):
    shown_ids = _ids(crystal, "201", "205")
    extra = _ids(crystal, "212")[0]
    shown = _preview(api, crystal, "out_of_service", True, shown_ids)
    done = _run(api, crystal, shown["ticket"], shown_ids + [extra]).json()
    assert done["done"] == 2
    assert _room(crystal, "212").out_of_service is False, "дописанный после показа номер тронут"
    assert _room(crystal, "201").out_of_service is True and _room(crystal, "205").out_of_service is True


def test_bite_one_transaction(api, crystal, monkeypatch):
    from apps.grms.models import RoomType, RoomTypeRoom
    from apps.grms.services import builder

    with tenant_context(crystal):
        code = (RoomType.objects.first() or RoomType.objects.create(code="t632", title={"ru": "Тип"})).code
        RoomTypeRoom.objects.filter(room__number__in=["301", "305", "312"]).delete()
    ids = _ids(crystal, "301", "305", "312")
    shown = _preview(api, crystal, "variant_set", code, ids)
    assert shown["summary"]["change"] == 3

    real = builder.assign_room_type
    calls = {"n": 0}

    def flaky(hotel, room, value):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("оборвалось на втором номере")
        return real(hotel, room, value)

    monkeypatch.setattr(builder, "assign_room_type", flaky)
    with pytest.raises(RuntimeError):
        _run(api, crystal, shown["ticket"], ids)
    with tenant_context(crystal):
        assert not RoomTypeRoom.objects.filter(room__number__in=["301", "305", "312"]).exists(), "первый номер остался с вариантом"


def test_bite_pins_never_in_journal_or_logs(api, crystal, caplog):
    from apps.core.models import AuditLog

    _module_on(crystal)
    ids = _ids(crystal, "401", "405", "412")
    shown = _preview(api, crystal, "pin_issue", "2031-05-01", ids)
    caplog.set_level(logging.DEBUG)
    done = _run(api, crystal, shown["ticket"], ids).json()
    pins = [p["pin"] for p in done["pins"]]
    assert [p["number"] for p in done["pins"]] == ["401", "405", "412"]
    assert len(set(pins)) == 3 and all(len(p) == 6 and p.isdigit() for p in pins)
    with tenant_context(crystal):
        journal = json.dumps([row.payload for row in AuditLog.objects.filter(hotel_id=crystal.pk)], ensure_ascii=False)
    for code in pins:
        assert code not in journal, "PIN попал в журнал"
        assert code not in caplog.text, "PIN попал в лог"
    # Показ после выдачи PIN не возвращает: «стало» — только «есть».
    again = _preview(api, crystal, "pin_issue", None, ids)
    assert code not in json.dumps(again)
    assert again["summary"]["warnings"]["pin_replaces"] == 3


def test_bite_read_only_403(api, client, crystal):
    invited = api("post", "/team", {"email": "ro632@platform.test", "role": "read_only"}).json()
    ro = _platform(client, "ro632@platform.test", invited["password"])
    ids = _ids(crystal, "201")
    assert ro("post", f"/hotels/{crystal.pk}/rooms/batch/preview", {"action": "active", "value": False, "room_ids": ids}).status_code == 403
    ticket = _preview(api, crystal, "active", False, ids)["ticket"]
    assert ro("post", f"/hotels/{crystal.pk}/rooms/batch", {"ticket": ticket, "room_ids": ids}).status_code == 403
    assert _room(crystal, "201").is_active is True


def test_bite_limit_500(api, crystal):
    too_many = api("post", f"/hotels/{crystal.pk}/rooms/batch/preview", {"action": "active", "value": False, "room_ids": [f"x{i}" for i in range(501)]})
    assert too_many.status_code == 422 and too_many.json()["code"] == "too_many_rooms"


def test_ticket_is_bound_to_person_and_not_forgeable(api, client, crystal):
    ids = _ids(crystal, "201")
    ticket = _preview(api, crystal, "active", False, ids)["ticket"]
    forged = _run(api, crystal, ticket[:-3] + "abc", ids)
    assert forged.status_code == 422 and forged.json()["code"] == "batch_ticket_invalid"
    invited = api("post", "/team", {"email": "sup632@platform.test", "role": "support"}).json()
    other = _platform(client, "sup632@platform.test", invited["password"])
    stolen = other("post", f"/hotels/{crystal.pk}/rooms/batch", {"ticket": ticket, "room_ids": ids})
    assert stolen.status_code in (403, 422)
    assert _room(crystal, "201").is_active is True


def test_delete_and_building_and_variant_warning(api, crystal):
    from apps.grms.models import RoomType, RoomTypeRoom

    with tenant_context(crystal):
        types = list(RoomType.objects.all()[:1]) or [RoomType.objects.create(code="t632a", title={"ru": "А"})]
        other = RoomType.objects.create(code="t632b", title={"ru": "Б"})
        RoomTypeRoom.objects.update_or_create(room=Room.objects.get(number="201"), defaults={"room_type": types[0]})
    ids = _ids(crystal, "201", "205")
    shown = _preview(api, crystal, "variant_set", other.code, ids)
    assert shown["summary"]["warnings"]["variant_changes"] >= 1

    building = api("post", f"/hotels/{crystal.pk}/buildings", {"title": {"ru": "Пачечный"}}).json()
    moved = _preview(api, crystal, "building", building["id"], ids)
    _run(api, crystal, moved["ticket"], ids)
    assert str(_room(crystal, "205").building_id) == building["id"]
    cleared = _preview(api, crystal, "building", "none", ids)
    _run(api, crystal, cleared["ticket"], ids)
    assert _room(crystal, "205").building_id is None

    gone = _preview(api, crystal, "delete", None, ids)
    assert gone["summary"]["change"] == 2
    _run(api, crystal, gone["ticket"], ids)
    with tenant_context(crystal):
        assert not Room.objects.filter(number__in=["201", "205"]).exists()


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_history_one_record_with_rooms(api, crystal):
    ids = _ids(crystal, "301", "305")
    shown = _preview(api, crystal, "out_of_service", True, ids)
    _run(api, crystal, shown["ticket"], ids)
    items = api("get", f"/hotels/{crystal.pk}/history?what=rooms").json()["items"]
    batch = [i for i in items if i["action"] == "room.batch"]
    assert len(batch) == 1, "должна быть одна запись на действие"
    assert {c["field"] for c in batch[0]["changes"]} == {"room:301", "room:305"}
    assert batch[0]["details"]["batch"] == "out_of_service"
    assert batch[0]["details"]["value"] is True
    # Поштучных записей правки номера рядом нет.
    assert not [i for i in items if i["action"] in ("room.updated", "room.bulk_updated")]
