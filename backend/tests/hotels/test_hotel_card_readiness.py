"""
КАРТОЧКА ОТЕЛЯ И ГОТОВНОСТЬ (партия 62-B).

Укус на каждое правило: данные → правило краснеет, данные исправлены →
зеленеет. Плюс:
* кэш готовности живёт минуту, правка сбрасывает его сразу;
* пакетное чтение оборудования пишет итог, и правило «неудачные обращения»
  его видит;
* «Отели» и сводка группы показывают настоящее число проблем;
* узел из карточки выпускается и отзывается только своего отеля;
* номерной фонд фильтруется на сервере.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.module_registry import set_modules
from apps.hotels.services.platform import readiness as readiness_svc

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

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
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kwargs
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


def _hotel(subdomain: str) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(subdomain=subdomain, name=subdomain.title(), admin_email=f"admin@{subdomain}.test").hotel


def _codes(hotel: Hotel) -> dict[str, int]:
    """Сработавшие правила → число (свежий расчёт, мимо кэша)."""
    result = readiness_svc.readiness(hotel, fresh=True)
    out: dict[str, int] = {}
    for problem in result["problems"]:
        out[problem["code"]] = out.get(problem["code"], 0) + problem["count"]
    return out


def _status(hotel: Hotel, code: str) -> str:
    rules = readiness_svc.readiness(hotel, fresh=True)["rules"]
    return next(rule["status"] for rule in rules if rule["code"] == code)


def _room_control(hotel: Hotel, on: bool = True) -> None:
    set_modules(hotel, [{"code": "room_control", "is_enabled": on}])


def _online_node(hotel: Hotel, name: str = "box"):
    from apps.hotels.models import OnPremNode
    from apps.hotels.services.onprem import register_node

    node, key = register_node(hotel, name=name, purpose="grms")
    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now())
    return node, key


def _room(hotel: Hotel, number: str, **fields):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return Room.objects.create(number=number, **fields)


def _variant(hotel: Hotel, code: str, rooms: list):
    from apps.grms.models import RoomType, RoomTypeRoom

    with tenant_context(hotel):
        room_type = RoomType.objects.create(code=code, title={"ru": code.title()})
        for room in rooms:
            RoomTypeRoom.objects.create(room=room, room_type=room_type)
    return room_type


def _publish(hotel: Hotel, room_type) -> None:
    from apps.grms.models import PublishedConfig

    with tenant_context(hotel):
        PublishedConfig.objects.create(room_type=room_type, version=1, payload={}, is_current=True, published_at=timezone.now())


def _pin(hotel: Hotel, room) -> None:
    from django.contrib.auth.hashers import make_password

    from apps.grms.models import RoomPin

    with tenant_context(hotel):
        RoomPin.objects.create(room=room, pin_hash=make_password("4321"), issued_at=timezone.now())


def _journal(hotel: Hotel, n: int, result: str, *, action: str = "grms.command", room: str = "101") -> None:
    from apps.core.models import AuditLog

    with tenant_context(hotel):
        for _ in range(n):
            AuditLog.record(
                action, actor_type=AuditLog.ActorType.SYSTEM, object_type="grms.channel",
                payload={"room": room, "result": result}, hotel_id=hotel.pk,
            )


def _menu(hotel: Hotel, *, location: bool = True):
    """Заведение с разделом и позицией; место подачи — по желанию."""
    from apps.catalog.models import Category, Item
    from apps.hotels.models import ExecutionPoint, Location, Service

    with tenant_context(hotel):
        Service.objects.update(is_active=False)
        Location.objects.update(is_active=False)
        point = ExecutionPoint.objects.create(code="kitchen-62b", title={"ru": "Кухня"}, kind=ExecutionPoint.Kind.OTHER)
        service = Service.objects.create(code="food-62b", execution_point=point, public_name={"ru": "Еда"})
        category = Category.objects.create(code="hot-62b", title={"ru": "Горячее"}, service=service)
        Item.objects.create(category=category, code="soup-62b", title={"ru": "Суп"}, price=500)
        if location:
            Location.objects.create(code="room-62b", title={"ru": "В номер"}, kind=Location.Kind.IN_ROOM)
    return service


# --- Восемь правил: краснеет → зеленеет ---------------------------------------


def test_bite_module_without_connection_turns_green_with_a_grms_node():
    hotel = _hotel("rd-module")
    _room_control(hotel)
    assert "module_without_connection" in _codes(hotel)
    problem = next(p for p in readiness_svc.readiness(hotel, fresh=True)["problems"] if p["code"] == "module_without_connection")
    assert problem["severity"] == "bad" and problem["fix"] == "connections"

    _online_node(hotel)
    assert "module_without_connection" not in _codes(hotel)
    assert _status(hotel, "module_without_connection") == "pass"


# Узел ищется платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_silent_connector_is_red_and_its_check_in_makes_it_green():
    from apps.hotels.models import OnPremNode
    from apps.hotels.services.onprem import register_node, touch

    hotel = _hotel("rd-silent")
    assert _status(hotel, "connector_silent") == "skip"  # коннектора нет — правило не о чем
    node, key = register_node(hotel, name="box", purpose="grms")
    assert _codes(hotel).get("connector_silent") == 1  # ни разу не выходил на связь

    touch(key)
    assert "connector_silent" not in _codes(hotel)

    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now() - timedelta(minutes=4))
    assert _codes(hotel).get("connector_silent") == 1  # молчит дольше 3 минут


def test_bite_rooms_without_variant_count_and_turn_green_when_bound():
    hotel = _hotel("rd-variant")
    _room_control(hotel)
    _online_node(hotel)
    rooms = [_room(hotel, n) for n in ("101", "102")]
    assert _codes(hotel).get("rooms_without_variant") == 2

    _variant(hotel, "std", rooms)
    assert "rooms_without_variant" not in _codes(hotel)


def test_bite_unpublished_variant_turns_green_after_publication():
    hotel = _hotel("rd-publish")
    _room_control(hotel)
    _online_node(hotel)
    room_type = _variant(hotel, "lux", [_room(hotel, "201")])
    problem = next(p for p in readiness_svc.readiness(hotel, fresh=True)["problems"] if p["code"] == "variant_unpublished")
    assert problem["params"] == {"variant": "Lux", "rooms": 1}

    _publish(hotel, room_type)
    assert "variant_unpublished" not in _codes(hotel)


def test_bite_failed_commands_need_ten_a_day_and_old_ones_do_not_count():
    from apps.core.models import AuditLog

    hotel = _hotel("rd-failed")
    _room_control(hotel)
    _online_node(hotel)
    _journal(hotel, 9, "failed")
    _journal(hotel, 5, "confirmed")
    assert "failed_commands" not in _codes(hotel)  # девять — ещё не проблема

    _journal(hotel, 1, "unconfirmed", room="305")
    problem = next(p for p in readiness_svc.readiness(hotel, fresh=True)["problems"] if p["code"] == "failed_commands")
    assert problem["count"] == 10 and problem["params"]["reason"] == "failed"
    assert set(problem["params"]["rooms"]) == {"101", "305"}

    with tenant_context(hotel):
        AuditLog.objects.filter(action="grms.command").update(created_at=timezone.now() - timedelta(days=2))
    assert "failed_commands" not in _codes(hotel)  # позавчерашние не в счёт


def test_bite_batch_reads_write_their_outcome_and_count_as_failures():
    """
    Пакетное чтение писало строку без итога — молчащий коннектор в чтениях
    правило не видело. Теперь итог есть, и десять неудачных пачек краснят.
    """
    from apps.core.models import AuditLog
    from apps.grms.services import commands

    hotel = _hotel("rd-batch")
    _room_control(hotel)
    _online_node(hotel, "other")  # узел есть, но для транспорта — мимо: ключа у коннектора нет
    from apps.hotels.models import OnPremNode

    with tenant_context(hotel):
        OnPremNode.objects.update(last_seen_at=None)
    for _ in range(10):
        commands.read_many(hotel, device="Dev", feedbacks=["Light", "Temp"], room="401", coalesce_s=0)
    with tenant_context(hotel):
        rows = list(AuditLog.objects.filter(action="grms.read").values_list("payload", flat=True))
    assert len(rows) == 10 and all(row["result"] == "CONNECTOR_OFFLINE" for row in rows)
    problem = next(p for p in readiness_svc.readiness(hotel, fresh=True)["problems"] if p["code"] == "failed_commands")
    assert problem["params"]["reason"] == "CONNECTOR_OFFLINE" and problem["params"]["rooms"] == ["401"]


def test_bite_no_menu_service_needs_both_items_and_a_place_to_serve():
    from apps.catalog.models import Category, ServiceLocation
    from apps.hotels.models import Location

    hotel = _hotel("rd-menu")
    service = _menu(hotel, location=False)
    assert "no_menu_service" in _codes(hotel)  # меню есть, подать некуда

    with tenant_context(hotel):
        location = Location.objects.create(code="room-62b", title={"ru": "В номер"}, kind=Location.Kind.IN_ROOM)
    assert "no_menu_service" not in _codes(hotel)

    # Матрица закрыла раздел во всех местах — тем же правилом, что заказ.
    with tenant_context(hotel):
        category = Category.objects.get(service=service)
        ServiceLocation.objects.create(category=category, location=location, is_enabled=False)
    assert "no_menu_service" in _codes(hotel)


def test_bite_rooms_without_pin_count_only_controlled_rooms():
    hotel = _hotel("rd-pin")
    _room_control(hotel)
    _online_node(hotel)
    bound = [_room(hotel, n) for n in ("501", "502")]
    _room(hotel, "503")  # без варианта — о PIN говорить рано
    _variant(hotel, "std", bound)
    problem = next(p for p in readiness_svc.readiness(hotel, fresh=True)["problems"] if p["code"] == "rooms_without_pin")
    assert problem["count"] == 2 and problem["severity"] == "info"

    _pin(hotel, bound[0])
    _pin(hotel, bound[1])
    assert "rooms_without_pin" not in _codes(hotel)


def test_bite_admin_who_never_logged_in_turns_green_after_a_password_login(client):
    from apps.accounts.models import User
    from tests.conftest import host_for

    hotel = _hotel("rd-admin")
    assert _codes(hotel).get("admin_never_logged_in") == 1
    with tenant_context(hotel):
        admin = User.objects.get(is_hotel_admin=True)
        admin.set_password("admin-62b-pass")
        admin.save()
    response = client.post(
        "/api/staff/auth/login",
        data={"email": admin.email, "password": "admin-62b-pass"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    assert "admin_never_logged_in" not in _codes(hotel)


def test_room_rules_are_skipped_while_room_control_is_off():
    hotel = _hotel("rd-skip")
    _room(hotel, "101")
    codes = _codes(hotel)
    assert not {"rooms_without_variant", "rooms_without_pin", "failed_commands", "variant_unpublished"} & set(codes)
    assert _status(hotel, "rooms_without_variant") == "skip"


# --- Кэш ----------------------------------------------------------------------


def test_readiness_is_cached_for_a_minute_and_an_edit_drops_the_cache():
    from apps.hotels.models import Room

    hotel = _hotel("rd-cache")
    _room_control(hotel)
    _online_node(hotel)
    room = _room(hotel, "101")
    first = readiness_svc.readiness(hotel)
    assert any(p["code"] == "rooms_without_variant" for p in first["problems"])

    # Массовая правка мимо сигналов — кэш честно держит прежнее...
    with tenant_context(hotel):
        Room.objects.filter(pk=room.pk).update(is_active=False)
    assert readiness_svc.readiness(hotel)["checked_at"] == first["checked_at"]

    # ...а правка через модель сбрасывает его сразу.
    with tenant_context(hotel):
        room.refresh_from_db()
        room.save()
    after = readiness_svc.readiness(hotel)
    assert after["checked_at"] != first["checked_at"]
    assert not any(p["code"] == "rooms_without_variant" for p in after["problems"])


# Узел ищется платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_revoking_a_node_drops_the_cache():
    from apps.hotels.services.onprem import revoke_key

    hotel = _hotel("rd-cache-node")
    _room_control(hotel)
    node, _ = _online_node(hotel)
    assert not any(p["code"] == "module_without_connection" for p in readiness_svc.readiness(hotel)["problems"])
    revoke_key(str(node.pk), hotel=hotel)
    assert any(p["code"] == "module_without_connection" for p in readiness_svc.readiness(hotel)["problems"])


# --- Ручки ---------------------------------------------------------------------


# Узел ищется платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_readiness_endpoint_and_the_real_problem_count_in_hotels_and_group(api):
    hotel = _hotel("rd-api")
    _room_control(hotel)
    response = api("get", f"/hotels/{hotel.pk}/readiness")
    assert response.status_code == 200
    body = response.json()
    assert [rule["code"] for rule in body["rules"]] == [code for code, _, _ in readiness_svc.RULES]
    expected = len(body["problems"])
    assert expected >= 2  # модуль без подключения и админ не входил

    group = api("post", "/groups", {"title": "Готовность", "hotel_ids": [str(hotel.pk)]}).json()
    rows = api("get", "/fleet?layout=list&origin=all&search=rd-api").json()["items"]
    assert next(r for r in rows if r["subdomain"] == "rd-api")["problems"] == expected
    page = api("get", f"/groups/{group['id']}").json()
    assert page["summary"]["problems"] == expected

    profile = api("get", f"/hotels/{hotel.pk}").json()
    assert profile["group"]["title"] == "Готовность"


# Узел ищется платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_a_node_is_issued_and_revoked_only_through_its_own_hotel(api):
    from apps.hotels.models import OnPremNode

    mine, other = _hotel("rd-node-a"), _hotel("rd-node-b")
    foreign, _ = _online_node(other, "their-box")

    # Чужой узел по адресу моего отеля — 404, и он жив.
    assert api("post", f"/hotels/{mine.pk}/nodes/{foreign.pk}/revoke", {}).status_code == 404
    assert api("post", f"/hotels/{mine.pk}/nodes/{foreign.pk}/reissue", {}).status_code == 404
    with tenant_context(other):
        assert not OnPremNode.objects.get(pk=foreign.pk).is_revoked

    created = api("post", f"/hotels/{mine.pk}/nodes", {"name": "my-box", "purpose": "grms"})
    assert created.status_code == 201
    node_id = created.json()["node"]["id"]
    listed = api("get", f"/hotels/{mine.pk}/nodes").json()["items"]
    assert [n["name"] for n in listed] == ["my-box"]  # чужого в списке нет

    reissued = api("post", f"/hotels/{mine.pk}/nodes/{node_id}/reissue", {})
    assert reissued.status_code == 200 and reissued.json()["key"]
    revoked = api("post", f"/hotels/{mine.pk}/nodes/{node_id}/revoke", {})
    assert revoked.status_code == 200 and revoked.json()["is_revoked"] is True
    with tenant_context(other):
        assert not OnPremNode.objects.get(pk=foreign.pk).is_revoked


def test_room_list_filters_on_the_server(api):
    hotel = _hotel("rd-rooms")
    _room_control(hotel)
    a, b = _room(hotel, "101", floor="1"), _room(hotel, "205", floor="2")
    _room(hotel, "210", floor="2")
    _variant(hotel, "std", [a, b])
    _pin(hotel, a)

    page = api("get", f"/hotels/{hotel.pk}/rooms").json()
    assert page["total"] == 3 and page["room_control"] is True
    assert {o["value"]: o["count"] for o in page["facets"]["variant"]} == {"std": 2, "none": 1}

    def numbers(query: str) -> list[str]:
        return [r["number"] for r in api("get", f"/hotels/{hotel.pk}/rooms?{query}").json()["items"]]

    assert numbers("search=2") == ["205", "210"]
    assert numbers("floor=2&variant=none") == ["210"]
    assert numbers("pin=yes") == ["101"]
    assert numbers("variant=std&pin=no") == ["205"]
