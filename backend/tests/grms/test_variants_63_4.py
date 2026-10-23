"""
ВАРИАНТЫ НОМЕРОВ — ПРАВКА ИЗ CONTROL (партия 63-4, шаг B).

Укусы:
* проверка смысла связи: «свет» на канал шторы — предупреждение (409), без
  явного согласия связь не ставится;
* вариант с номерами не удаляется — сервер говорит, сколько их;
* публикация меняет ровно N номеров варианта — и только при совпадении N;
* тестовая команда уходит только с подтверждением «номер, что, значение»;
* копия из другого отеля не тащит чужие номера, версии и кадры;
* «только чтение» — 403 на правку; правки видны в «Истории» «было → стало».
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.grms.models import Binding, ControlElement, PublishedConfig, RoomType, RoomTypeRoom, Variable

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root634@platform.test"
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


def _hotel(sub: str):
    from apps.hotels.models import HotelModule
    from apps.hotels.services.provisioning import provision_hotel

    hotel = provision_hotel(subdomain=sub, name=f"Варианты {sub}", admin_email=f"admin@{sub}.test").hotel
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True})
    return hotel


@pytest.fixture
def hotel():
    return _hotel("var634")


def _channels(hotel, code: str):
    """Каналы, как после загрузки файла пусконаладки."""
    with tenant_context(hotel):
        room_type = RoomType.objects.get(code=code)
        RoomType.objects.filter(pk=room_type.pk).update(device_name_template="Room {room}")
        for key, command, feedback in (("light_1", "C_Light1", "F_Light1"), ("curtain_1", "C_Curtain1", "F_Curtain1")):
            Variable.objects.create(room_type=room_type, key=key, command=command, feedback=feedback, value_kind="binary", min_value=0, max_value=1)


def _variant(api, hotel, title: str) -> str:
    resp = api("post", f"/hotels/{hotel.pk}/grms/variants", {"title": {"ru": title}, "plan_level": "tiles"})
    assert resp.status_code == 200, resp.content
    code = resp.json()["code"]
    _channels(hotel, code)
    return code


def _rooms(hotel, code: str, numbers: list[str]):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        room_type = RoomType.objects.get(code=code)
        for number in numbers:
            room = Room.objects.create(number=number)
            RoomTypeRoom.objects.create(room=room, room_type=room_type)


def _light(api, hotel, code: str) -> str:
    resp = api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons", {"kind": "light_group", "title": {"ru": "Свет"}})
    assert resp.status_code == 200, resp.content
    return resp.json()["slug"]


def test_bite_sense_check_light_on_curtain_channel(api, hotel):
    code = _variant(api, hotel, "Стандарт")
    slug = _light(api, hotel, code)
    base = f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{slug}"

    channels = api("get", f"{base}/channels?capability=toggle").json()["channels"]
    assert channels[0]["key"] == "light_1" and channels[0]["fit"] == "good"
    curtain = next(c for c in channels if c["key"] == "curtain_1")
    assert curtain["fit"] == "warn" and curtain["sense"] == {"code": "subject_mismatch", "expected": "light", "found": "curtain"}

    wrong = api("post", f"{base}/link", {"capability": "toggle", "variable": "curtain_1"})
    assert wrong.status_code == 409 and wrong.json()["code"] == "binding_sense_warning"
    with tenant_context(hotel):
        assert not Binding.objects.filter(element__slug=slug).exists(), "без согласия связь не ставится"

    accepted = api("post", f"{base}/link", {"capability": "toggle", "variable": "curtain_1", "accept_warning": True})
    assert accepted.status_code == 200
    right = api("post", f"{base}/link", {"capability": "toggle", "variable": "light_1"})
    assert right.status_code == 200 and right.json()["sense"] is None

    buttons = api("get", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons").json()["buttons"]
    assert buttons[0]["publishable"] and not buttons[0]["missing"]

    # Один канал — одна кнопка: занятый канал — понятный отказ, а не ошибка базы.
    other = _light(api, hotel, code)
    taken = api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{other}/link", {"capability": "toggle", "variable": "light_1"})
    assert taken.status_code == 409 and taken.json()["code"] == "channel_taken" and taken.json()["button"] == "Свет"
    fits = {c["key"]: c for c in api("get", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{other}/channels?capability=toggle").json()["channels"]}
    assert fits["light_1"]["fit"] == "bad" and fits["light_1"]["taken_by"] == "Свет"

    # Канал убранной кнопки свободен: удаление настройки — настоящее, а не мягкое.
    assert api("delete", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{slug}").status_code == 200
    freed = api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{other}/link", {"capability": "toggle", "variable": "light_1"})
    assert freed.status_code == 200, freed.content
    again = _light(api, hotel, code)
    assert again == slug, "код убранной кнопки снова свободен"

    # Обязательная возможность не связана — понятно, чего не хватает; связь снимается.
    api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{other}/unlink", {"capability": "toggle", "variable": ""})
    buttons = {b["slug"]: b for b in api("get", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons").json()["buttons"]}
    assert buttons[other]["missing"] == ["toggle"] and not buttons[other]["publishable"]
    assert buttons[again]["missing"] == ["toggle"]
    # Снятая связь не держит канал: его снова можно отдать.
    assert api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{again}/link", {"capability": "toggle", "variable": "light_1"}).status_code == 200


def test_bite_variant_with_rooms_is_not_deleted(api, hotel):
    code = _variant(api, hotel, "Люкс")
    _rooms(hotel, code, ["101", "102", "103"])
    resp = api("delete", f"/hotels/{hotel.pk}/grms/variants/{code}")
    assert resp.status_code == 409 and resp.json()["code"] == "variant_has_rooms" and resp.json()["rooms"] == 3
    with tenant_context(hotel):
        assert RoomType.objects.filter(code=code).exists()
        RoomTypeRoom.objects.filter(room_type__code=code).delete()
    assert api("delete", f"/hotels/{hotel.pk}/grms/variants/{code}").status_code == 200
    with tenant_context(hotel):
        assert not RoomType.objects.filter(code=code).exists()


def test_bite_publish_changes_exactly_n_rooms(api, hotel):
    a = _variant(api, hotel, "Стандарт")
    b = _variant(api, hotel, "Семейный")
    _rooms(hotel, a, ["201", "202"])
    _rooms(hotel, b, ["301"])
    for code in (a, b):
        slug = _light(api, hotel, code)
        api("post", f"/hotels/{hotel.pk}/grms/variants/{code}/buttons/{slug}/link", {"capability": "toggle", "variable": "light_1"})

    stale = api("post", f"/hotels/{hotel.pk}/grms/variants/{a}/publish", {"rooms": 5})
    assert stale.status_code == 409 and stale.json()["code"] == "publish_rooms_changed" and stale.json()["rooms"] == 2
    with tenant_context(hotel):
        assert not PublishedConfig.objects.exists(), "с неверным N ничего не публикуется"

    done = api("post", f"/hotels/{hotel.pk}/grms/variants/{a}/publish", {"rooms": 2})
    assert done.status_code == 200 and done.json() == {"version": 1, "rooms": 2}
    from apps.grms.services.guest import resolve_context_for_room
    from apps.hotels.models import Room

    with tenant_context(hotel):
        changed = [r.number for r in Room.objects.order_by("number") if resolve_context_for_room(hotel, r.pk)[0] is not None]
        assert not PublishedConfig.objects.filter(room_type__code=b).exists(), "соседний вариант не тронут"
    assert changed == ["201", "202"], f"версию получили не ровно номера варианта: {changed}"

    assert api("post", f"/hotels/{hotel.pk}/grms/variants/{a}/rollback", {"to_version": 1}).status_code == 422, "откат без подтверждения"


def test_bite_test_command_only_with_confirmation(api, hotel, monkeypatch):
    from apps.grms.services import roomcheck

    code = _variant(api, hotel, "Стандарт")
    slug = _light(api, hotel, code)
    sent = []
    monkeypatch.setattr(roomcheck, "check_element", lambda hotel, **kw: sent.append(kw) or {"outcome": "confirmed"})
    url = f"/hotels/{hotel.pk}/grms/variants/{code}/test"
    body = {"element": slug, "room_number": "305", "capability": "toggle", "value": 1}

    for confirm in (None, {}, {"room": "306", "element": slug, "value": 1}, {"room": "305", "element": slug, "value": 0}, {"room": "305", "element": "x", "value": 1}):
        resp = api("post", url, {**body, "confirm": confirm})
        assert resp.status_code == 422 and resp.json()["code"] == "test_needs_confirm", confirm
    assert not sent, "команда ушла без подтверждения"

    assert api("post", url, {**body, "confirm": {"room": "305", "element": slug, "value": 1}}).status_code == 200
    assert sent == [{"room_type_code": code, "element_slug": slug, "room_number": "305", "capability": "toggle", "value": 1}]


def test_bite_copy_from_other_hotel_takes_no_rooms(api, hotel):
    donor = _hotel("don634")
    code = _variant(api, donor, "Донор")
    slug = _light(api, donor, code)
    api("post", f"/hotels/{donor.pk}/grms/variants/{code}/buttons/{slug}/link", {"capability": "toggle", "variable": "light_1"})
    _rooms(donor, code, ["501", "502"])
    api("post", f"/hotels/{donor.pk}/grms/variants/{code}/publish", {"rooms": 2})
    with tenant_context(donor):
        RoomType.objects.filter(code=code).update(plan={"asset_id": "11111111-1111-1111-1111-111111111111", "zones": [{"code": "z", "hit": {"x": 1, "y": 1, "w": 5, "h": 5}}]})

    sources = api("get", f"/hotels/{hotel.pk}/grms/variants/sources").json()["hotels"]
    assert any(h["hotel_id"] == str(donor.pk) for h in sources)
    assert all("rooms" not in v for h in sources for v in h["variants"]), "в источниках нет чужих номеров"

    resp = api("post", f"/hotels/{hotel.pk}/grms/variants", {"title": {"ru": "Копия"}, "source": code, "source_hotel": str(donor.pk)})
    assert resp.status_code == 200, resp.content
    copy = resp.json()["code"]
    with tenant_context(hotel):
        new = RoomType.objects.get(code=copy)
        assert not RoomTypeRoom.objects.filter(room_type=new).exists(), "копия унесла чужие номера"
        assert not PublishedConfig.objects.filter(room_type=new).exists(), "копия унесла чужие версии"
        assert "asset_id" not in new.plan and new.plan["zones"], "кадр — чужой ассет, разметка — своя"
        assert ControlElement.objects.filter(room_type=new).count() == 1
        assert Binding.objects.filter(element__room_type=new, variable__key="light_1").exists()
    with tenant_context(donor):
        assert RoomTypeRoom.objects.filter(room_type__code=code).count() == 2, "донор не тронут"


def test_bite_read_only_403_and_history(api, client, hotel):
    code = _variant(api, hotel, "Стандарт")
    assert api("put", f"/hotels/{hotel.pk}/grms/variants/{code}", {"title": {"ru": "Стандарт плюс"}, "notes": "", "plan_level": "simple"}).status_code == 200
    history = api("get", f"/hotels/{hotel.pk}/history?what=roomControl").json()["items"]
    changes = {c["field"]: c for i in history for c in i["changes"]}
    assert changes["title_ru"]["from"] == "Стандарт" and changes["title_ru"]["to"] == "Стандарт плюс"
    assert changes["plan_level"]["from"] == "tiles" and changes["plan_level"]["to"] == "simple"

    invited = api("post", "/team", {"email": "ro634@platform.test", "role": "read_only"}).json()
    ro = _platform(client, "ro634@platform.test", invited["password"])
    v = f"/hotels/{hotel.pk}/grms/variants"
    assert ro("get", v).status_code == 200
    for method, path, body in (
        ("post", v, {"title": {"ru": "X"}}),
        ("put", f"{v}/{code}", {"title": {"ru": "X"}, "plan_level": "tiles"}),
        ("delete", f"{v}/{code}", None),
        ("post", f"{v}/{code}/buttons", {"kind": "light_group"}),
        ("post", f"{v}/{code}/zones", {"title": {"ru": "Z"}}),
        ("post", f"{v}/{code}/publish", {"rooms": 0}),
        ("post", f"{v}/{code}/test", {"element": "x", "room_number": "1", "capability": "toggle", "value": 1}),
    ):
        assert ro(method, path, body).status_code == 403, (method, path)
