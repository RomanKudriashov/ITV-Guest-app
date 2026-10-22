"""
МОДУЛИ БЕЗ ТАРИФОВ (партия 62-E1).

Укусы:
* заготовку включить нельзя — 409 `module_in_development`; выключить можно;
* одиночный PUT трогает ровно один модуль (старый «весь список» ставил
  остальным «выключено вручную»);
* журнал — «был → стал» по коду;
* группа не принимает заготовку ни в действие, ни в умолчания;
* миграция 0049 выключает заготовки и пишет журнал — на данных, по отелям;
* каталог и карточка модуля; тарифы больше не читаются (сторож).
"""

from __future__ import annotations

import importlib
import json
import re
from pathlib import Path

import pytest

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel, HotelModule

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"
DEV = ["pms", "payment", "mobile_key", "native_app", "analytics_level", "multi_restaurant", "extra_languages"]


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


def _state(hotel: Hotel) -> dict[str, bool]:
    with tenant_context(hotel):
        return dict(HotelModule.objects.values_list("code", "is_enabled"))


def test_registry_is_the_one_place_and_lists_seven_in_development():
    from apps.hotels.module_registry import DEV_CODES, MODULES, READY_CODES

    assert sorted(DEV_CODES) == sorted(DEV)
    assert sorted(READY_CODES) == ["marketing", "room_control"]
    assert MODULES["room_control"].needs == "grms"


def test_bite_a_module_in_development_cannot_be_switched_on_but_can_be_off(api):
    hotel = _hotel("mod-dev")
    refused = api("put", f"/hotels/{hotel.pk}/modules/pms", {"enabled": True})
    assert refused.status_code == 409 and refused.json()["code"] == "module_in_development"
    assert not _state(hotel).get("pms")

    # Включённую до 62-E1 заготовку выключить можно.
    with tenant_context(hotel):
        HotelModule.objects.create(code="pms", is_enabled=True)
    off = api("put", f"/hotels/{hotel.pk}/modules/pms", {"enabled": False})
    assert off.status_code == 200 and _state(hotel)["pms"] is False


def test_bite_one_switch_touches_exactly_one_module_and_journals_it(api):
    hotel = _hotel("mod-one")
    api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": True})
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code="room_control", defaults={"is_enabled": True, "config": {"guest_entry_demo": True}})
        # Выключенная строка без намерения: старый «весь список» писал ей `off`.
        HotelModule.objects.update_or_create(code="pms", defaults={"is_enabled": False, "intent": ""})
        before = {m.code: (m.is_enabled, m.intent, m.updated_at) for m in HotelModule.objects.exclude(code="marketing")}

    response = api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": False})
    assert response.status_code == 200
    with tenant_context(hotel):
        after = {m.code: (m.is_enabled, m.intent, m.updated_at) for m in HotelModule.objects.exclude(code="marketing")}
        config = HotelModule.objects.get(code="room_control").config
    assert after == before  # другие строки не тронуты вовсе — ни флаг, ни время
    assert config == {"guest_entry_demo": True}

    with tenant_context(hotel):
        rows = list(AuditLog.objects.filter(action="platform.hotel.modules_set").order_by("created_at").values_list("payload", flat=True))
    assert rows == [{"module": "marketing", "from": False, "to": True}, {"module": "marketing", "from": True, "to": False}]
    # Повтор без смены — записи нет.
    api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": False})
    with tenant_context(hotel):
        assert AuditLog.objects.filter(action="platform.hotel.modules_set").count() == 2


def test_the_old_whole_list_put_is_gone(api):
    hotel = _hotel("mod-old")
    response = api("put", f"/hotels/{hotel.pk}/modules", {"modules": [{"code": "marketing", "is_enabled": True}]})
    assert response.status_code in (404, 405)


def test_bite_a_group_takes_no_module_in_development(api):
    hotel = _hotel("mod-group")
    group = api("post", "/groups", {"title": "Модули 62e1", "hotel_ids": [str(hotel.pk)]}).json()
    preview = api("post", f"/groups/{group['id']}/actions/preview", {"kind": "module_on", "module": "pms"})
    assert preview.status_code == 422 and preview.json()["code"] == "module_in_development"
    run = api("post", f"/groups/{group['id']}/actions", {"kind": "module_on", "module": "pms", "hotel_ids": [str(hotel.pk)]})
    assert run.status_code == 422
    defaults = api("put", f"/groups/{group['id']}/defaults", {"enabled": True, "modules": ["marketing", "mobile_key"]})
    assert defaults.status_code == 422 and defaults.json()["code"] == "module_in_development"
    assert api("put", f"/groups/{group['id']}/defaults", {"enabled": True, "modules": ["marketing"]}).status_code == 200
    # Выключить заготовку группой можно.
    assert api("post", f"/groups/{group['id']}/actions/preview", {"kind": "module_off", "module": "pms"}).status_code == 200


def test_bite_migration_0049_switches_dev_off_by_hotel_and_journals(crystal):
    """
    На ДАННЫХ, а не на пустых таблицах, и тем же путём, что на стенде: по отелям
    под `tenant_context`, через подключение миграции.
    """
    from django.apps import apps as django_apps
    from django.db import connection

    from apps.hotels.models import HotelGroup

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(code="pms", defaults={"is_enabled": True, "intent": "on"})
        HotelModule.objects.update_or_create(code="analytics_level", defaults={"is_enabled": True})
        HotelModule.objects.update_or_create(code="marketing", defaults={"is_enabled": True})
    group = HotelGroup.objects.create(code="mig-62e1", title="Миграция", auto_enabled=True, auto_modules=["marketing", "pms"])

    migration = importlib.import_module("apps.hotels.migrations.0049_modules_in_development_off")

    class _Editor:
        pass

    editor = _Editor()
    editor.connection = connection
    migration.forwards(django_apps, editor)

    state = _state(crystal)
    assert state["pms"] is False and state["analytics_level"] is False and state["marketing"] is True
    with tenant_context(crystal):
        assert HotelModule.objects.get(code="pms").intent == ""
        assert HotelModule.objects.filter(code="pms").exists()  # строку не удалили
        journal = sorted(
            (p["module"], p["from"], p["to"], p["reason"])
            for p in AuditLog.objects.filter(action="platform.hotel.modules_set", payload__reason="in_development").values_list("payload", flat=True)
        )
    assert journal == [("analytics_level", True, False, "in_development"), ("pms", True, False, "in_development")]
    group.refresh_from_db()
    assert group.auto_modules == ["marketing"]
    from apps.hotels.services.platform.groups import history

    entry = [row for row in history(group) if row["action"] == "platform.group.defaults_set"]
    assert entry and entry[0]["payload"]["changes"]["auto_modules"] == {"from": ["marketing", "pms"], "to": ["marketing"]}

    # Повторный проход ничего не меняет и журнал не множит.
    migration.forwards(django_apps, editor)
    with tenant_context(crystal):
        assert AuditLog.objects.filter(payload__reason="in_development").count() == 2


def test_catalog_and_module_card(api):
    a, b = _hotel("mod-cat-a"), _hotel("mod-cat-b")
    api("put", f"/hotels/{a.pk}/modules/marketing", {"enabled": True})
    catalog = api("get", "/modules").json()
    items = {row["code"]: row for row in catalog["items"]}
    assert items["pms"]["status"] == "dev" and items["room_control"]["needs"] == "grms"
    assert items["marketing"]["enabled_hotels"] >= 1

    card = api("get", "/modules/marketing?state=on&search=mod-cat").json()
    assert [row["subdomain"] for row in card["hotels"]["items"]] == ["mod-cat-a"]
    assert card["journal"][0]["subdomain"] == "mod-cat-a" and card["journal"][0]["to"] is True
    off = api("get", "/modules/marketing?state=off&search=mod-cat").json()
    assert [row["subdomain"] for row in off["hotels"]["items"]] == ["mod-cat-b"]
    page = api("get", "/modules/marketing?search=mod-cat&limit=1").json()
    nxt = api("get", f"/modules/marketing?search=mod-cat&limit=1&cursor={page['hotels']['next_cursor']}").json()
    assert page["hotels"]["items"][0]["subdomain"] != nxt["hotels"]["items"][0]["subdomain"]
    assert api("get", "/modules/nope").status_code == 404


def test_catalog_and_card_are_cut_to_the_scope(api, client):
    """Администратор сети видит в каталоге и карточке только свои отели."""
    from apps.hotels.models import PlatformScopeGroup

    mine, theirs = _hotel("mod-scope-mine"), _hotel("mod-scope-theirs")
    group_id = api("post", "/groups", {"code": "mod-netw", "title": "Сеть", "kind": "network", "mode": "list"}).json()["id"]
    api("post", f"/groups/{group_id}/members", {"hotel_ids": [str(mine.pk)]})
    invited = api("post", "/team", {"email": "net62e1@platform.test", "role": "support"}).json()
    PlatformScopeGroup.objects.create(user_id=invited["member"]["id"], group_id=group_id)
    api("put", f"/hotels/{theirs.pk}/modules/marketing", {"enabled": True})

    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": "net62e1@platform.test", "password": invited["password"]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    ).json()["access"]
    kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
    scoped = {row["code"]: row for row in client.get("/api/v1/platform/modules", **kwargs).json()["items"]}
    full = {row["code"]: row for row in api("get", "/modules").json()["items"]}
    assert scoped["marketing"]["enabled_hotels"] < full["marketing"]["enabled_hotels"]
    card = client.get("/api/v1/platform/modules/marketing", **kwargs).json()
    assert {row["subdomain"] for row in card["hotels"]["items"]} == {"mod-scope-mine"}
    assert "mod-scope-theirs" not in json.dumps(card["journal"], ensure_ascii=False)


def test_tariffs_endpoints_are_gone(api):
    hotel = _hotel("mod-tariff")
    assert api("get", "/tariffs").status_code == 404
    assert api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "business"}).status_code in (404, 405)
    assert api("get", f"/hotels/{hotel.pk}/usage").status_code == 404
    assert "tariff" not in api("get", f"/hotels/{hotel.pk}").json()
    assert "trial" not in api("get", "/overview").json()["hotels"]


def test_bite_nothing_reads_tariffs_any_more():
    """Сторож: `tariff|trial_ends_at` в коде приложений — только в моделях и миграциях."""
    root = Path(__file__).resolve().parents[2] / "apps"
    offenders = []
    for path in root.rglob("*.py"):
        parts = path.relative_to(root).parts
        if "migrations" in parts or "models" in parts or path.name == "models.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"tariff|trial_ends_at", line):
                offenders.append(f"{path.relative_to(root)}:{number}: {line.strip()}")
    assert offenders == [], "\n".join(offenders)
