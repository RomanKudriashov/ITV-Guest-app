"""
СОРТИРОВКА В CONTROL (партия 62-F) — укусы через выдачу ручек.

* номера «по-человечески»: 2 < 3 < 3А < 10 < 101 (а не «10» перед «2»);
* пустые — в конце при любом направлении;
* чужое поле — 422 `invalid_sort` на каждой сортируемой выдаче;
* журнал с выбранным столбцом листается смещением и не теряет строк;
* текст без регистра, «ё» = «е».
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.core.listing import natural_key, sort_rows, text_key
from apps.hotels.models import Hotel

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


def _hotel(subdomain: str, name: str | None = None) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(subdomain=subdomain, name=name or subdomain.title(), admin_email=f"admin@{subdomain}.test").hotel


def test_rules_text_and_natural():
    assert text_key("Ёлка") == text_key("елка")
    assert sorted(["10", "2", "3А", "101", "3"], key=natural_key) == ["2", "3", "3А", "10", "101"]
    rows = [{"f": "2"}, {"f": ""}, {"f": "10"}, {"f": None}, {"f": "1"}]
    allowed = {"f": ("natural", lambda r: r["f"])}
    up = [r["f"] for r in sort_rows(rows, "f", "asc", allowed)]
    down = [r["f"] for r in sort_rows(rows, "f", "desc", allowed)]
    assert up[:3] == ["1", "2", "10"] and set(up[3:]) == {"", None}
    assert down[:3] == ["10", "2", "1"] and set(down[3:]) == {"", None}


def test_bite_rooms_sort_naturally_and_blank_floor_last(api):
    from apps.hotels.models import Room

    hotel = _hotel("sort-rooms")
    with tenant_context(hotel):
        Room.objects.all().delete()
        for number, floor in (("10", "1"), ("2", ""), ("3А", "2"), ("101", "10"), ("3", "")):
            Room.objects.create(number=number, floor=floor)
    up = api("get", f"/hotels/{hotel.pk}/rooms?sort=number&dir=asc").json()["items"]
    assert [r["number"] for r in up] == ["2", "3", "3А", "10", "101"]
    down = api("get", f"/hotels/{hotel.pk}/rooms?sort=number&dir=desc").json()["items"]
    assert [r["number"] for r in down] == ["101", "10", "3А", "3", "2"]
    floors_up = [r["floor"] for r in api("get", f"/hotels/{hotel.pk}/rooms?sort=floor&dir=asc").json()["items"]]
    floors_down = [r["floor"] for r in api("get", f"/hotels/{hotel.pk}/rooms?sort=floor&dir=desc").json()["items"]]
    assert floors_up == ["1", "2", "10", "", ""]
    assert floors_down == ["10", "2", "1", "", ""]


def test_bite_foreign_field_is_422_everywhere(api):
    hotel = _hotel("sort-422")
    paths = [
        "/fleet?layout=list",
        "/fleet?layout=groups",
        "/team",
        "/audit",
        f"/hotels/{hotel.pk}/history",
        f"/hotels/{hotel.pk}/rooms",
        f"/hotels/{hotel.pk}/nodes",
        "/modules/marketing",
        "/impersonations",
    ]
    for path in paths:
        sep = "&" if "?" in path else "?"
        response = api("get", f"{path}{sep}sort=password_hash")
        assert response.status_code == 422, (path, response.status_code)
        assert response.json()["code"] == "invalid_sort", path
        bad_dir = api("get", f"{path}{sep}sort={'number' if 'rooms' in path else 'name' if 'nodes' in path or 'fleet' in path or 'modules/' in path else 'member' if 'team' in path else 'hotel' if 'impersonations' in path else 'at'}&dir=sideways")
        assert bad_dir.status_code == 422, (path, "dir")


def test_fleet_sorts_by_rooms_and_puts_ungrouped_last_by_group(api):
    from apps.hotels.models import Room

    small, big = _hotel("sort-small", "Малый"), _hotel("sort-big", "Большой")
    for hotel, count in ((small, 1), (big, 3)):
        with tenant_context(hotel):
            Room.objects.all().delete()
            for i in range(count):
                Room.objects.create(number=str(i + 1))
    rows = api("get", "/fleet?layout=list&origin=all&search=sort-&sort=rooms&dir=desc").json()["items"]
    mine = [r["subdomain"] for r in rows if r["subdomain"] in ("sort-small", "sort-big")]
    assert mine == ["sort-big", "sort-small"]
    group = api("post", "/groups", {"title": "Сортировка", "hotel_ids": [str(small.pk)]}).json()
    for direction in ("asc", "desc"):
        listed = api("get", f"/fleet?layout=list&origin=all&search=sort-&sort=group&dir={direction}").json()["items"]
        order = [r["subdomain"] for r in listed if r["subdomain"] in ("sort-small", "sort-big")]
        # Без группы — в конце при любом направлении.
        assert order == ["sort-small", "sort-big"], direction
    api("delete", f"/groups/{group['id']}?confirm_title=Сортировка")


def test_journal_sorted_by_column_pages_by_offset_without_losing_rows(api):
    hotel = _hotel("sort-journal")
    for code in ("marketing", "room_control", "marketing", "room_control", "marketing"):
        current = {m["code"]: m["is_enabled"] for m in api("get", f"/hotels/{hotel.pk}/modules").json()["modules"]}
        api("put", f"/hotels/{hotel.pk}/modules/{code}", {"enabled": not current[code]})
    everything = api("get", f"/hotels/{hotel.pk}/history?sort=action&dir=asc&limit=100").json()
    first = api("get", f"/hotels/{hotel.pk}/history?sort=action&dir=asc&limit=2").json()
    assert first["next_cursor"] == "o:2"
    seen = list(first["items"])
    cursor = first["next_cursor"]
    while cursor:
        page = api("get", f"/hotels/{hotel.pk}/history?sort=action&dir=asc&limit=2&cursor={cursor}").json()
        seen += page["items"]
        cursor = page["next_cursor"]
    assert [r["id"] for r in seen] == [r["id"] for r in everything["items"]]
    actions = [r["action"] for r in seen]
    assert actions == sorted(actions)


def test_team_sorts_role_by_strength(api):
    api("post", "/team", {"email": "sort-ro@platform.test", "role": "read_only"})
    api("post", "/team", {"email": "sort-sup@platform.test", "role": "support"})
    roles = [m["role"] for m in api("get", "/team?sort=role&dir=asc&limit=200").json()["items"]]
    rank = {"owner": 0, "support": 1, "read_only": 2}
    assert [rank[r] for r in roles] == sorted(rank[r] for r in roles)
