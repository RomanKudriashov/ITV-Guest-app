"""
СЕРВЕР УПРАВЛЕНИЯ ОТЕЛЯ ИЗ CONTROL (партия 63-3) — облачная половина.

Укусы:
* секрет не в ответах API, не в журнале; в базе — зашифрованным; коннектору —
  заголовком;
* без сервера в Control — коннектору `endpoints: null` (старое поведение);
* «только чтение» — 403 на правку, проверку и проверку номера;
* проверка номера только читает — ни одной команды SET;
* «скоро» (Bittel, «другое») — настроить нельзя.
"""

from __future__ import annotations

import base64
import json

import pytest

from apps.core.context import tenant_context
from apps.grms.models import ControlServer

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root633@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"
SECRET = "pa55-63-3-very-secret"


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

    return provision_hotel(subdomain="srv633", name="Сервер 63-3", admin_email="admin@srv633.test").hotel


def test_bite_secret_never_leaves_except_to_connector(api, hotel):
    from apps.core.models import AuditLog
    from apps.grms.services import control_server

    put = api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.15", "port": 1085, "auth": "basic", "login": "naviroom", "secret": SECRET})
    assert put.status_code == 200, put.content
    assert SECRET not in put.content.decode()
    assert put.json()["server"]["has_secret"] is True
    assert SECRET not in api("get", f"/hotels/{hotel.pk}/control-server").content.decode()
    with tenant_context(hotel):
        stored = ControlServer.objects.get()
        journal = json.dumps([row.payload for row in AuditLog.objects.filter(hotel_id=hotel.pk)], ensure_ascii=False)
    assert SECRET not in stored.secret_sealed and stored.secret_sealed, "секрет в базе открытым"
    assert SECRET not in journal, "секрет в журнале"
    history = api("get", f"/hotels/{hotel.pk}/history?what=connections").json()["items"]
    change = next(c for i in history for c in i["changes"] if c["field"] == "control_secret")
    assert change["to"] == "changed"
    # Коннектор получает его заголовком — единственное место расшифровки.
    message = control_server.settings_message(hotel.pk)
    expected = "Basic " + base64.b64encode(f"naviroom:{SECRET}".encode()).decode()
    assert message["endpoints"]["iridi"] == {"baseUrl": "http://10.10.20.15:1085", "timeoutMs": 3000, "headers": {"Authorization": expected}}

    # Правка без нового секрета — прежний сохраняется; «без входа» — стирается.
    api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.16", "port": 1085, "auth": "basic", "login": "naviroom"})
    assert control_server.settings_message(hotel.pk)["endpoints"]["iridi"]["headers"] == {"Authorization": expected}
    api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.16", "port": 1085, "auth": "none"})
    assert control_server.settings_message(hotel.pk)["endpoints"]["iridi"]["headers"] == {}


def test_bite_without_control_server_connector_uses_local_file(api, hotel):
    from apps.grms.services import control_server

    assert control_server.settings_message(hotel.pk)["endpoints"] is None
    api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.15", "port": 1085, "is_enabled": False})
    assert control_server.settings_message(hotel.pk)["endpoints"] is None, "выключенный сервер не должен уходить коннектору"
    api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.10.20.15", "port": 1085})
    assert control_server.settings_message(hotel.pk)["endpoints"]["iridi"]["baseUrl"] == "http://10.10.20.15:1085"
    assert api("delete", f"/hotels/{hotel.pk}/control-server").json()["server"] is None
    assert control_server.settings_message(hotel.pk)["endpoints"] is None


def test_soon_kinds_and_validation(api, hotel):
    for kind in ("bittel", "other"):
        resp = api("put", f"/hotels/{hotel.pk}/control-server", {"kind": kind, "host": "10.0.0.1", "port": 21221})
        assert resp.status_code == 422 and resp.json()["code"] == "control_server_kind_soon"
    assert api("put", f"/hotels/{hotel.pk}/control-server", {"host": "http://10.0.0.1/x", "port": 1085}).status_code == 422
    assert api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.0.0.1", "port": 70000}).status_code == 422
    assert api("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.0.0.1", "port": 1085, "auth": "token"}).status_code == 422


def test_bite_read_only_403(api, client, hotel):
    invited = api("post", "/team", {"email": "ro633@platform.test", "role": "read_only"}).json()
    ro = _platform(client, "ro633@platform.test", invited["password"])
    assert ro("get", f"/hotels/{hotel.pk}/control-server").status_code == 200
    assert ro("put", f"/hotels/{hotel.pk}/control-server", {"host": "10.0.0.1", "port": 1085}).status_code == 403
    assert ro("delete", f"/hotels/{hotel.pk}/control-server").status_code == 403
    assert ro("post", f"/hotels/{hotel.pk}/control-server/check", {}).status_code == 403
    assert ro("post", f"/hotels/{hotel.pk}/control-server/room-check", {"room_id": "00000000-0000-0000-0000-000000000000"}).status_code == 403


def test_bite_room_check_only_reads(hotel, monkeypatch):
    from apps.grms.services import control_server, guest
    from apps.grms.transport import transport
    from apps.hotels.models import Room

    with tenant_context(hotel):
        room = Room.objects.create(number="101")

    class Context:
        def __init__(self):
            self.room = room
            self.device = "Room 101"
            self.payload = {"subdevice": ""}
            self.controls = [{"channels": {"on": {"feedback": "light_fb"}, "level": {"feedback": "dim_fb"}}}]

    monkeypatch.setattr(guest, "resolve_context_for_room", lambda h, rid: (Context(), ""))
    monkeypatch.setattr(transport, "node_is_online", lambda h: True)
    sent = []

    async def fake_asend(hotel_id, envelope, *, ttl_ms):
        sent.append(envelope)
        return {"type": "connector.response", "requestID": envelope["requestID"], "ok": True, "status_code": 200, "raw_body": json.dumps({"requestID": envelope["requestID"], "value": 1}), "duration_ms": 1}

    monkeypatch.setattr(transport, "asend", fake_asend)
    result = control_server.read_room(hotel, room.pk)
    assert sent, "ничего не прочитали"
    requests = [e["body"]["request"] for e in sent]
    assert set(requests) == {"GET"}, f"проверка номера послала не только чтение: {requests}"
    assert result["read"] == 2 and result["device"] == "Room 101"


def test_readiness_server_silent_only_when_connector_online(hotel):
    from django.utils import timezone

    from apps.grms.services import liveness
    from apps.hotels.models import HotelModule, OnPremNode
    from apps.hotels.services.onprem import register_node
    from apps.hotels.services.platform.readiness import compute

    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True})
    node, _ = register_node(hotel, name="Узел", purpose=OnPremNode.Purpose.GRMS)
    liveness.remember_endpoints(hotel.pk, {"iridi": {"reachable": False}})
    codes = {p["code"] for p in compute(hotel)["problems"]}
    assert "connector_silent" in codes and "control_server_silent" not in codes, "про сервер за молчащим коннектором говорить нечего"
    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now())
    codes = {p["code"] for p in compute(hotel)["problems"]}
    assert "control_server_silent" in codes and "connector_silent" not in codes
    liveness.remember_endpoints(hotel.pk, {"iridi": {"reachable": True}})
    assert "control_server_silent" not in {p["code"] for p in compute(hotel)["problems"]}
