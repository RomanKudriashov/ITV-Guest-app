"""
Укусы партии 60 — срочное по разведкам Control и CMS.

Каждый тест — ровно то, что разведка поймала руками: сначала поломка на
живых данных, потом проверка, что её больше нет. Порча данных, дыры в правах
и тупики нового отеля; подтверждения на экранах проверяет e2e.
"""

from __future__ import annotations

import importlib
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule
from tests.conftest import CmsClient, staff_token_for
from tests.hotels.test_platform_scope import _call, _hotel, _login, owner, scoped  # noqa: F401

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


# --- 1. Порча данных ----------------------------------------------------------


# «Один щелчок — один модуль» после 62-E1 держит одиночный PUT
# (`test_modules_62e1.test_bite_one_switch_touches_exactly_one_module_and_journals_it`).


def test_module_toggle_does_not_roll_back_demo_entry(owner, crystal):  # noqa: F811
    """Демо-вход включён в CMS после загрузки консоли — щелчок в консоли его не гасит."""
    from apps.grms.services.access import set_demo_entry

    owner("put", f"/hotels/{crystal.pk}/modules/room_control", {"enabled": True})
    set_demo_entry(crystal, True)
    owner("put", f"/hotels/{crystal.pk}/modules/marketing", {"enabled": True})
    owner("put", f"/hotels/{crystal.pk}/modules/room_control", {"enabled": True})
    with tenant_context(crystal):
        module = HotelModule.objects.get(code="room_control")
    assert module.config.get("guest_entry_demo") is True


def test_mass_off_migration_resets_only_the_batch_outside_the_tariff(crystal):
    """
    Критерий миграции 0045: `off` + выключен + тариф не даёт + записан пачкой.
    Одиночный щелчок и `off` у модуля из тарифа — настоящие решения, их не трогаем.
    """
    from django.apps import apps as django_apps
    from django.db import connection

    from apps.hotels.migrations import _tariffs_frozen as tariffs

    crystal.tariff = "business"
    crystal.save(update_fields=["tariff"])
    granted = set(tariffs.modules_for(crystal.tariff))
    outside = [code for code in (c.value for c in HotelModule.Code) if code not in granted]
    inside = sorted(granted)
    assert len(outside) >= 3 and inside, "сетка тарифов поменялась — тест надо пересобрать"

    long_ago = timezone.now() - timedelta(days=3)
    with tenant_context(crystal):
        HotelModule.objects.all().hard_delete()
        batch = [*outside[:2], inside[0]]
        for code in batch:
            HotelModule.objects.create(code=code, is_enabled=False, intent="off")
        HotelModule.objects.filter(code__in=batch).update(updated_at=long_ago)
        HotelModule.objects.create(code=outside[2], is_enabled=False, intent="off")
        HotelModule.objects.filter(code=outside[2]).update(updated_at=long_ago - timedelta(hours=5))

    migration = importlib.import_module("apps.hotels.migrations.0045_module_intent_mass_off")

    class _Editor:
        pass

    editor = _Editor()
    editor.connection = connection
    migration.forwards(django_apps, editor)

    with tenant_context(crystal):
        intents = dict(HotelModule.objects.values_list("code", "intent"))
    assert intents[outside[0]] == "" and intents[outside[1]] == ""
    # Модуль из тарифа: выключен руками — так и остаётся.
    assert intents[inside[0]] == "off"
    # Одиночная запись — не пачка.
    assert intents[outside[2]] == "off"


def test_profile_save_keeps_translations_of_name_and_city(owner, crystal):  # noqa: F811
    crystal.name = {"ru": "Кристалл", "en": "Crystal", "zh": "水晶"}
    crystal.city = {"ru": "Сочи", "en": "Sochi"}
    crystal.save(update_fields=["name", "city"])

    owner("patch", f"/hotels/{crystal.pk}", {"name": "Отель «Кристалл»"})
    owner("patch", f"/hotels/{crystal.pk}", {"city": {crystal.default_language: "Адлер"}})
    crystal.refresh_from_db()

    assert crystal.name[crystal.default_language] == "Отель «Кристалл»"
    assert crystal.name["en"] == "Crystal" and crystal.name["zh"] == "水晶"
    assert crystal.city[crystal.default_language] == "Адлер"
    assert {key for key in crystal.city} >= {"ru", "en"}


def test_profile_save_of_one_field_does_not_touch_the_name(owner, crystal):  # noqa: F811
    crystal.name = {"ru": "Кристалл", "en": "Crystal"}
    crystal.save(update_fields=["name"])
    owner("patch", f"/hotels/{crystal.pk}", {"timezone": "Europe/Moscow"})
    crystal.refresh_from_db()
    assert crystal.name == {"ru": "Кристалл", "en": "Crystal"}


def test_empty_sla_means_inherit_and_zero_is_refused(cms, service_id):
    point = cms.get(f"/api/cms/services/{service_id}").json()["execution_point"]
    assert "effective_sla_minutes" in point

    cleared = cms.patch(f"/api/cms/services/{service_id}", {"sla_minutes": None})
    assert cleared.status_code == 200, cleared.content
    after = cleared.json()["execution_point"]
    assert after["sla_minutes"] is None
    assert after["effective_sla_minutes"] > 0

    zero = cms.patch(f"/api/cms/services/{service_id}", {"sla_minutes": 0})
    assert zero.status_code in (400, 422), zero.content


def test_new_service_is_created_with_inherited_sla(cms):
    created = cms.post("/api/cms/services", {"type": "restaurant", "public_name": {"ru": "Новый ресторан"}})
    assert created.status_code == 201, created.content
    point = created.json()["execution_point"]
    assert point["sla_minutes"] is None
    assert point["effective_sla_minutes"] > 0


def test_service_creation_is_atomic(cms, crystal, monkeypatch):
    """Упавшее создание заведения не оставляет исполнителя-сироту."""
    from apps.hotels.models import ExecutionPoint, Service

    with tenant_context(crystal):
        before = ExecutionPoint.objects.count()

    def boom(*args, **kwargs):
        raise RuntimeError("падение посреди создания")

    monkeypatch.setattr(Service.objects, "create", boom)
    with pytest.raises(RuntimeError):
        cms.post("/api/cms/services", {"type": "restaurant", "public_name": {"ru": "Сирота"}})
    with tenant_context(crystal):
        assert ExecutionPoint.objects.count() == before


def test_bulk_edit_moves_rooms_to_another_building(cms, crystal):
    building = cms.post("/api/cms/buildings", {"title": {"ru": "Северный"}})
    assert building.status_code in (200, 201), building.content
    building_id = building.json()["id"]
    rooms = cms.get("/api/cms/rooms?limit=3").json()["items"]
    ids = [room["id"] for room in rooms]

    result = cms.post(
        "/api/cms/rooms/bulk-update",
        {"selection": {"ids": ids}, "patch": {"building_id": building_id}},
    )
    assert result.status_code == 200, result.content
    assert result.json()["changed"] == len(ids)
    after = {room["id"]: room for room in cms.get("/api/cms/rooms?limit=200").json()["items"]}
    assert all(after[room_id]["building_id"] == building_id for room_id in ids)
    assert all(after[room_id]["zone"] == "Северный" for room_id in ids)


# --- 2. Опасное: второй фактор ------------------------------------------------


def test_disabling_2fa_needs_a_code(client, owner):  # noqa: F811
    from apps.accounts.services import totp

    secret = owner("post", "/auth/2fa/setup").json()["secret"]
    fresh = owner("post", "/auth/2fa/enable", {"code": totp.code_at(secret)}).json()["access"]
    api = _call(client, fresh)

    assert api("post", "/auth/2fa/disable", {"code": "000000"}).status_code in (400, 422)
    assert api("post", "/auth/2fa/disable", {"code": totp.code_at(secret)}).status_code == 200


# --- 3. Права -----------------------------------------------------------------


def test_analytics_export_belongs_to_its_requester(client, crystal, cms_manager):
    from apps.accounts.models import User
    from apps.analytics.services.export import create_export

    with tenant_context(crystal):
        admin = User.objects.get(email=f"owner@{crystal.subdomain}.local")
        export = create_export(crystal.pk, admin, kind="breakdown", export_format="csv", params={})

    assert cms_manager.get(f"/api/cms/analytics/export/{export.pk}").status_code == 404
    assert cms_manager.get(f"/api/cms/analytics/export/{export.pk}/download").status_code == 404

    admin_client = CmsClient(client, crystal, staff_token_for(client, crystal, "owner"))
    assert admin_client.get(f"/api/cms/analytics/export/{export.pk}").status_code == 200


def test_badges_need_the_marketing_module(cms, crystal):
    with tenant_context(crystal):
        HotelModule.objects.filter(code="marketing").update(is_enabled=False)
    refused = cms.post("/api/cms/badges", {"label": {"ru": "Сезон"}, "color_role": "accent"})
    assert refused.status_code == 403, refused.content
    assert refused.json().get("code") == "module_disabled"


def test_manager_cannot_badge_a_foreign_item(cms, cms_manager, crystal):
    from apps.accounts.models import User
    from apps.accounts.services.roles import access_for
    from apps.catalog.models import Item

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(code="marketing", defaults={"is_enabled": True})
        manager = User.objects.get(email=f"manager.restaurant@{crystal.subdomain}.local")
        managed = access_for(manager).managed_point_ids
        items = list(Item.objects.select_related("category__service"))
        foreign = next(i for i in items if i.category.service and str(i.category.service.execution_point_id) not in managed)
        own = next(i for i in items if i.category.service and str(i.category.service.execution_point_id) in managed)
    badge_id = cms.get("/api/cms/badges").json()["items"][0]["id"]

    denied = cms_manager.put(f"/api/cms/badges/{badge_id}/items/{foreign.pk}", {"attached": True})
    assert denied.status_code == 403, denied.content
    allowed = cms_manager.put(f"/api/cms/badges/{badge_id}/items/{own.pk}", {"attached": True})
    assert allowed.status_code == 200, allowed.content


def test_reply_to_review_is_for_those_who_read_the_chat(client, crystal, cms_manager):
    from tests.chat.api.test_chat_reviews import _finished_order, guest_for

    guest = guest_for(client, crystal, room="212")
    order_id = _finished_order(client, crystal, guest, key="batch60-reply")
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 2, "comment": "холодно"}).json()["id"]

    refused = cms_manager.post(f"/api/cms/reviews/{review_id}/reply", {"text": "Простите нас"})
    assert refused.status_code == 403, refused.content
    assert refused.json().get("code") == "chat_forbidden"


# Узел ищется платформенным подключением — ему нужен настоящий коммит.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_node_keys_obey_the_group_scope(owner, scoped):  # noqa: F811
    api, mine, theirs = scoped["api"], scoped["mine"], scoped["theirs"]
    foreign = owner("post", f"/hotels/{theirs.pk}/nodes", {"name": "far", "purpose": "grms"}).json()["node"]
    own = owner("post", f"/hotels/{mine.pk}/nodes", {"name": "near", "purpose": "grms"}).json()["node"]

    assert api("post", f"/nodes/{foreign['id']}/revoke").status_code == 404
    assert api("post", f"/nodes/{foreign['id']}/reissue").status_code == 404
    assert api("post", f"/nodes/{own['id']}/reissue").status_code == 200


# Сводка читает платформенным подключением — ему нужен настоящий коммит.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_overview_counts_only_the_scope(owner, scoped):  # noqa: F811
    from apps.analytics.models import OrderDaily

    with tenant_context(scoped["theirs"]):
        OrderDaily.objects.create(business_date=timezone.localdate(), orders_count=7)
    assert scoped["api"]("get", "/overview").json()["orders_today"] == 0
    assert owner("get", "/overview").json()["orders_today"] >= 7


def test_team_list_obeys_the_group_scope(owner, scoped):  # noqa: F811
    emails = {row["email"] for row in scoped["api"]("get", "/team").json()["items"]}
    assert emails == {"net@platform.test"}
    everyone = {row["email"] for row in owner("get", "/team").json()["items"]}
    assert "root@platform.test" in everyone


# --- 4. Тупики ----------------------------------------------------------------


def test_new_hotel_can_take_an_order_right_away():
    """
    Новый отель — с локацией «В номер», и раздел, заведённый в нём, сразу
    в матрице: гостю есть куда доставить.
    """
    from apps.catalog.models import ServiceLocation
    from apps.catalog.services.cms import create_category
    from apps.core.context import actor_context
    from apps.hotels.models import Location, Service
    from apps.hotels.services.provisioning import provision_hotel

    result = provision_hotel(subdomain="fresh60", name="Свежий", admin_email="a@fresh60.test")
    hotel = result.hotel
    with tenant_context(hotel):
        locations = list(Location.objects.all())
        assert [(loc.code, loc.kind) for loc in locations] == [("in_room", Location.Kind.IN_ROOM)]

        from apps.hotels.services.admin_services import create_service

        with actor_context(result.admin):
            service = create_service({"type": Service.Type.RESTAURANT, "public_name": {"ru": "Кухня"}})
            category = create_category({"title": {"ru": "Горячее"}, "service_id": str(service.pk)})
        assert ServiceLocation.objects.filter(category=category, location=locations[0]).exists()


def test_rooms_without_pin_are_listed(cms, crystal):
    from apps.hotels.models import Room

    from apps.grms.models import RoomPin, RoomType, RoomTypeRoom

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True})
        room_type = RoomType.objects.first() or RoomType.objects.create(code="std60", title={"ru": "Стандарт"})
        rooms = list(Room.objects.filter(is_active=True)[:2])
        for room in rooms:
            RoomTypeRoom.objects.get_or_create(room=room, defaults={"room_type": room_type})
        RoomPin.objects.filter(room__in=rooms).delete()

    state = cms.get("/api/cms/grms/access").json()
    assert {room.number for room in rooms} <= set(state["rooms_without_pin"])
