"""
СИСТЕМНЫЕ ЗАПИСИ В «ИСТОРИИ» (партия 62-E1-хвост).

На стенде миграция 0049 выключила 12 модулей в разработке и записала каждый в
журнал отеля от имени системы, а «История» отеля их не показывала: она брала
только записи людей Control. Укусы — через ВЫДАЧУ ручки, а не через журнал:
запись лежала в журнале и тогда, а экран был пуст.
"""

from __future__ import annotations

import importlib
import json

import pytest

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel, HotelModule

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


def _run_migration_0049() -> None:
    """Тот самый путь, что на стенде: миграция пишет журнал от имени системы."""
    from django.apps import apps as django_apps
    from django.db import connection

    class _Editor:
        pass

    editor = _Editor()
    editor.connection = connection
    importlib.import_module("apps.hotels.migrations.0049_modules_in_development_off").forwards(django_apps, editor)


@pytest.fixture
def hotel_with_system_entry(api):
    hotel = _hotel("hist-sys")
    with tenant_context(hotel):
        HotelModule.objects.create(code="pms", is_enabled=True)
        # Системная запись другого рода — не правка отеля, в «Историю» не идёт.
        AuditLog.record("grms.command", hotel_id=hotel.pk, payload={"room": "101"})
    _run_migration_0049()
    # И правка человека — чтобы фильтр «Система» было от чего отличать.
    api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": True})
    return hotel


def test_bite_system_entry_is_in_the_hotel_history(api, hotel_with_system_entry):
    body = api("get", f"/hotels/{hotel_with_system_entry.pk}/history").json()
    system = [row for row in body["items"] if row["actor"]["role"] == "system"]
    assert len(system) == 1, body["items"]
    row = system[0]
    assert row["action"] == "platform.hotel.modules_set"
    assert row["changes"] == [{"field": "module:pms", "from": True, "to": False}]
    assert row["details"]["reason"] == "in_development"
    assert row["actor"]["id"] is None
    # Оборудование и прочие системные записи в «Историю» правок не попадают.
    assert not [r for r in body["items"] if r["action"].startswith("grms.")]
    assert body["total"] == 2


def test_bite_filter_system_returns_only_system_entries(api, hotel_with_system_entry):
    body = api("get", f"/hotels/{hotel_with_system_entry.pk}/history?who=system").json()
    assert body["total"] == 1
    assert [row["actor"]["role"] for row in body["items"]] == ["system"]
    assert [row["changes"][0]["field"] for row in body["items"]] == ["module:pms"]

    # Фасет «кто» считает и систему, и человека.
    who = {f["value"]: f["count"] for f in body["facets"]["who"]}
    assert who.get("system") == 1
    assert sum(who.values()) == 2
    # Раздел «Модули» в фасете «что» — обе записи.
    what = {f["value"]: f["count"] for f in body["facets"]["what"]}
    assert what.get("modules") == 2


def test_bite_section_filter_shows_system_module_entries(api, hotel_with_system_entry):
    """Ровно то, что на стенде было пустым: «История» → «Что: Модули»."""
    body = api("get", f"/hotels/{hotel_with_system_entry.pk}/history?what=modules").json()
    assert body["total"] == 2
    assert {row["actor"]["role"] for row in body["items"]} == {"system", "owner"}


def test_group_history_shows_system_entry(api):
    from apps.hotels.models import HotelGroup

    group = HotelGroup.objects.create(code="hist-sys-g", title="История", auto_enabled=True, auto_modules=["marketing", "pms"])
    _run_migration_0049()
    body = api("get", f"/groups/{group.pk}/history").json()
    rows = body["items"]
    entry = [row for row in rows if row["action"] == "platform.group.defaults_set"]
    assert entry and entry[0]["actor"] == ""
    assert entry[0]["payload"]["changes"]["auto_modules"] == {"from": ["marketing", "pms"], "to": ["marketing"]}
