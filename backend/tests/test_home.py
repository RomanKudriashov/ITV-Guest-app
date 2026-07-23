"""
Стартовая: активные заказы гостя и быстрые действия.
"""

from __future__ import annotations

import pytest

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _guest(client, hotel, token):
    def get(path):
        return client.get(path, HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}")

    def post(path, data):
        return client.post(
            path, data=data, content_type="application/json",
            HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    return get, post


def _place_caesar(client, hotel, token, *, key, qty=1):
    get, _ = _guest(client, hotel, token)
    menu = get("/api/v1/guest/catalog?type=product").json()
    caesar = next(
        i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar"
    )
    return client.post(
        "/api/v1/guest/order",
        data={"lines": [{"item_id": caesar["id"], "quantity": qty}]},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )


# --- Активные заказы -------------------------------------------------------


def test_active_orders_carry_strip_fields(client, crystal, guest_token):
    resp = _place_caesar(client, crystal, guest_token, key="home-1", qty=2)
    assert resp.status_code in (200, 201), resp.content

    get, _ = _guest(client, crystal, guest_token)
    active = get("/api/v1/guest/orders/active").json()
    assert len(active["orders"]) == 1
    order = active["orders"][0]
    assert order["status"]["code"]
    assert order["serve_by"]
    assert order["total"]
    assert order["summary"]  # короткий состав
    assert "extra_count" in order


def test_active_orders_scoped_to_the_guest(client, crystal, guest_token):
    _place_caesar(client, crystal, guest_token, key="home-mine")

    # Другой гость (другая сессия) не видит чужие активные заказы.
    other = client.post(
        "/api/v1/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    get_other, _ = _guest(client, crystal, other)
    assert get_other("/api/v1/guest/orders/active").json()["orders"] == []


def test_terminal_orders_are_not_active(client, crystal, guest_token):
    from apps.core.context import tenant_context
    from apps.orders.services import change_status, get_order

    resp = _place_caesar(client, crystal, guest_token, key="home-done")
    order_id = resp.json()["id"]
    with tenant_context(crystal):
        change_status(get_order(order_id), to_code="done", actor_type="staff")

    get, _ = _guest(client, crystal, guest_token)
    assert get("/api/v1/guest/orders/active").json()["orders"] == []


# --- Быстрые действия ------------------------------------------------------


def test_home_quick_actions_default(client, crystal, guest_token):
    get, _ = _guest(client, crystal, guest_token)
    home = get("/api/v1/guest/home").json()
    codes = [a["code"] for a in home["quick_actions"]]
    # Дефолт: наполненные разделы + чат — стартовая не пустая.
    assert "chat" in codes
    assert "menu" in codes
    for action in home["quick_actions"]:
        assert action["route"] and action["icon"] and action["title"]


def test_quick_actions_saved_reach_the_guest(client, crystal, cms, guest_token):
    cms.put("/api/v1/cms/quick-actions", {"selected": ["chat", "menu"]})
    get, _ = _guest(client, crystal, guest_token)
    home = get("/api/v1/guest/home").json()
    assert [a["code"] for a in home["quick_actions"]] == ["chat", "menu"]


def test_quick_actions_reject_unknown_code(cms):
    resp = cms.put("/api/v1/cms/quick-actions", {"selected": ["bogus"]})
    assert resp.status_code == 422
    assert resp.json()["code"] == "unknown_quick_action"


def test_quick_actions_isolated_between_hotels(client, crystal, aurora, cms, cms_aurora):
    cms.put("/api/v1/cms/quick-actions", {"selected": ["chat"]})
    aurora_selected = cms_aurora.get("/api/v1/cms/quick-actions").json()["selected"]
    assert aurora_selected != ["chat"] or len(aurora_selected) > 1
