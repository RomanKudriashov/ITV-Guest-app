"""
НЕСКОЛЬКО ПОДКЛЮЧЕНИЙ У ОТЕЛЯ (партия 65).

Демо-номера на эмуляторе и номер 100 на настоящем iRidi объекта — в одном
отеле. Подключение = сервер управления + свой коннектор; номер назначается
подключению, без назначения — «по умолчанию».

Укусы:
* команда номера уходит ЕГО коннектору, а не всем коннекторам отеля;
* коннектор получает настройки только своего подключения;
* у коннектора одно подключение — второе на тот же коннектор отбивается;
* убрали подключение — его номера вернулись на «по умолчанию»;
* схема номеров показывает подключение номера и считает «нет связи» по нему;
* пакетное «назначить подключение» — с показом «было → стало».
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.grms.models import ControlServer, RoomConnection

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root65@platform.test"
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


@pytest.fixture
def hotel():
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(subdomain="multi65", name="Два подключения", admin_email="admin@multi65.test").hotel


def _node(hotel, name: str, *, online: bool = True):
    from django.utils import timezone

    from apps.hotels.models import OnPremNode

    with tenant_context(hotel):
        return OnPremNode.objects.create(
            hotel=hotel,
            name=name,
            purpose="grms",
            key_hash=f"hash-{name}",
            last_seen_at=timezone.now() if online else None,
        )


def _rooms(hotel, *numbers):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return {n: Room.objects.create(hotel=hotel, number=n) for n in numbers}


def _two_connections(api, hotel):
    """Эмулятор «по умолчанию» и настоящий iRidi — каждый со своим коннектором."""
    emu = _node(hotel, "Эмулятор")
    real = _node(hotel, "Объект")
    first = api("put", f"/hotels/{hotel.pk}/control-server", {"name": "Эмулятор", "host": "iridi-emulator", "port": 1085, "node_id": str(emu.pk)})
    assert first.status_code == 200, first.content
    second = api("put", f"/hotels/{hotel.pk}/control-server?new=1", {"name": "iRidi объекта", "host": "192.168.155.17", "port": 1085, "node_id": str(real.pk)})
    assert second.status_code == 200, second.content
    return emu, real, first.json()["server"]["id"], second.json()["server"]["id"]


def test_two_connections_first_is_default(api, hotel):
    _, _, emu_id, real_id = _two_connections(api, hotel)
    items = api("get", f"/hotels/{hotel.pk}/connections").json()["items"]
    assert [i["id"] for i in items] == [emu_id, real_id], "«по умолчанию» первым"
    assert items[0]["is_default"] is True and items[1]["is_default"] is False
    assert items[1]["label"] == "iRidi объекта"


def test_bite_command_goes_to_the_rooms_own_connector(api, hotel, monkeypatch):
    """Номер 100 на iRidi объекта — задание уходит ЕГО коннектору, 202 — эмулятору."""
    from apps.grms.transport import transport

    emu, real, _, real_id = _two_connections(api, hotel)
    rooms = _rooms(hotel, "100", "202")
    assert api("post", f"/hotels/{hotel.pk}/connections/assign", {"connection": real_id, "room_ids": [str(rooms["100"].pk)]}).json()["changed"] == 1

    sent = []

    async def fake_asend(hotel_id, envelope, *, ttl_ms, node_id):
        sent.append(node_id)
        return {"type": "connector.response", "requestID": envelope["requestID"], "ok": True, "raw_body": ""}

    monkeypatch.setattr(transport, "asend", fake_asend)
    transport.send(hotel, {"requestID": "r1", "ttl_ms": 1000}, number="100")
    transport.send(hotel, {"requestID": "r2", "ttl_ms": 1000}, number="202")
    assert sent == [str(real.pk), str(emu.pk)], "команда ушла не своему коннектору"


def test_bite_connector_gets_only_its_own_settings(api, hotel):
    from apps.grms.services import control_server

    emu, real, _, _ = _two_connections(api, hotel)
    assert control_server.settings_message(emu.pk)["endpoints"]["iridi"]["baseUrl"] == "http://iridi-emulator:1085"
    assert control_server.settings_message(real.pk)["endpoints"]["iridi"]["baseUrl"] == "http://192.168.155.17:1085"
    stranger = _node(hotel, "Лишний")
    assert control_server.settings_message(stranger.pk)["endpoints"] is None, "чужой адрес отдан коннектору без подключения"


def test_bite_one_connection_per_connector(api, hotel):
    emu, _, _, _ = _two_connections(api, hotel)
    again = api("put", f"/hotels/{hotel.pk}/control-server?new=1", {"host": "10.0.0.9", "port": 1085, "node_id": str(emu.pk)})
    assert again.status_code == 409, again.content
    assert again.json()["code"] == "connector_has_connection"


def test_removed_connection_returns_rooms_to_default(api, hotel):
    _, _, emu_id, real_id = _two_connections(api, hotel)
    rooms = _rooms(hotel, "100")
    api("post", f"/hotels/{hotel.pk}/connections/assign", {"connection": real_id, "room_ids": [str(rooms["100"].pk)]})
    gone = api("delete", f"/hotels/{hotel.pk}/control-server?connection={real_id}")
    assert gone.status_code == 200, gone.content
    with tenant_context(hotel):
        assert not RoomConnection.objects.filter(room=rooms["100"]).exists()
    detail = api("get", f"/hotels/{hotel.pk}/rooms/{rooms['100'].pk}/detail").json()
    assert detail["connection"]["id"] == emu_id and detail["connection"]["explicit"] is False


def test_removed_default_promotes_the_next(api, hotel):
    _, _, emu_id, real_id = _two_connections(api, hotel)
    api("delete", f"/hotels/{hotel.pk}/control-server?connection={emu_id}")
    with tenant_context(hotel):
        assert ControlServer.objects.get(pk=real_id).is_default is True


def test_make_default(api, hotel):
    _, _, emu_id, real_id = _two_connections(api, hotel)
    items = api("post", f"/hotels/{hotel.pk}/connections/{real_id}/default").json()["items"]
    assert [i["id"] for i in items if i["is_default"]] == [real_id]


def test_room_map_shows_connection_and_link_per_connection(api, hotel):
    """«Нет связи» — по коннектору подключения номера: молчит эмулятор, а номер 100 на живом объекте."""
    from apps.hotels.models import HotelModule
    from apps.hotels.models import OnPremNode

    emu, real, emu_id, real_id = _two_connections(api, hotel)
    rooms = _rooms(hotel, "100", "202")
    api("post", f"/hotels/{hotel.pk}/connections/assign", {"connection": real_id, "room_ids": [str(rooms["100"].pk)]})
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True})
        OnPremNode.objects.filter(pk=emu.pk).update(last_seen_at=None)
    data = api("get", f"/hotels/{hotel.pk}/rooms/map").json()
    by_number = {r["number"]: r for b in data["buildings"] for f in b["floors"] for r in f["rooms"]}
    assert by_number["100"]["connection"] == {"id": real_id, "name": "iRidi объекта", "default": False, "explicit": True}
    assert by_number["202"]["connection"]["id"] == emu_id and by_number["202"]["connection"]["explicit"] is False
    assert "no_link" not in by_number["100"]["problems"], "живой объект засчитан «без связи» из-за эмулятора"
    assert "no_link" in by_number["202"]["problems"]
    facet = {f["value"]: f["count"] for f in data["facets"]["connection"]}
    assert facet == {emu_id: 1, real_id: 1}


def test_batch_connection_set_shows_before_after(api, hotel):
    _, _, _, real_id = _two_connections(api, hotel)
    rooms = _rooms(hotel, "100", "101")
    ids = [str(r.pk) for r in rooms.values()]
    preview = api("post", f"/hotels/{hotel.pk}/rooms/batch/preview", {"action": "connection_set", "value": real_id, "room_ids": ids}).json()
    assert preview["summary"]["change"] == 2
    assert {r["to"] for r in preview["rows"]} == {"iRidi объекта"}
    assert all(r["from"].startswith("по умолчанию") for r in preview["rows"])
    done = api("post", f"/hotels/{hotel.pk}/rooms/batch", {"ticket": preview["ticket"], "room_ids": ids}).json()
    assert done["done"] == 2
    again = api("post", f"/hotels/{hotel.pk}/rooms/batch/preview", {"action": "connection_set", "value": real_id, "room_ids": ids}).json()
    assert again["summary"]["same"] == 2, "повтор назначения — «без изменений»"
    back = api("post", f"/hotels/{hotel.pk}/rooms/batch/preview", {"action": "connection_set", "value": "", "room_ids": ids}).json()
    assert back["summary"]["change"] == 2 and all(r["to"].startswith("по умолчанию") for r in back["rows"])


def test_room_card_changes_connection(api, hotel):
    _, _, _, real_id = _two_connections(api, hotel)
    rooms = _rooms(hotel, "100")
    rid = str(rooms["100"].pk)
    patched = api("patch", f"/hotels/{hotel.pk}/rooms/{rid}", {"connection": real_id})
    assert patched.status_code == 200, patched.content
    assert patched.json()["connection"]["id"] == real_id
    dictionaries = api("get", f"/hotels/{hotel.pk}/rooms/dictionaries").json()
    assert {c["id"] for c in dictionaries["connections"]} >= {real_id}
    reset = api("patch", f"/hotels/{hotel.pk}/rooms/{rid}", {"connection": None}).json()
    assert reset["connection"]["explicit"] is False


def test_single_connection_hotel_works_as_before(api, hotel, monkeypatch):
    """Отель с одним подключением без назначений — команды идут как до партии 65."""
    from apps.grms.transport import transport

    node = _node(hotel, "Единственный")
    assert api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.15", "port": 1085}).status_code == 200
    _rooms(hotel, "305")
    sent = []

    async def fake_asend(hotel_id, envelope, *, ttl_ms, node_id):
        sent.append(node_id)
        return {"type": "connector.response", "requestID": envelope["requestID"], "ok": True, "raw_body": ""}

    monkeypatch.setattr(transport, "asend", fake_asend)
    transport.send(hotel, {"requestID": "r1", "ttl_ms": 1000}, number="305")
    assert sent == [str(node.pk)]
