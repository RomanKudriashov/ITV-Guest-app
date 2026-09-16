"""
Места получения заказа учитывают матрицу «категория × локация».

Матрица долго была декоративной: гостю показывались все локации отеля, и заказ
принимался в любую. Теперь одно правило — для списка мест и для заказа:
  * у категории есть связки — только отмеченные места;
  * связок нет («не настроена») — все места доставки, но не точки выдачи.

В демо «Кристалла»: «Горячее» — в номер и к бассейну; коктейли бара — туда же
и у стойки лобби-бара (точка выдачи).
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, ServiceLocation
from apps.core.context import tenant_context
from apps.hotels.models import Location
from tests.catalog.api.test_guest_storefront import Guest, open_session, place
from tests.conftest import host_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def guest(client, crystal):
    response = open_session(client, crystal)
    assert response.status_code == 200, response.content
    return Guest(client, crystal, response.json()["token"])


def _item(guest, category_code: str) -> dict:
    menu = guest.get("/api/guest/catalog?type=product").json()
    return next(
        item
        for category in menu["categories"]
        if category["code"] == category_code
        for item in category["items"]
        if not item["has_required_modifiers"]
    )


def _places(guest, *items) -> dict[str, dict]:
    query = ",".join(item["id"] for item in items)
    body = guest.get(f"/api/guest/locations?items={query}").json()
    return {entry["code"]: entry for entry in body["locations"]}


def _order(guest, item, location_code, key, refinement=""):
    location_id = _place_id(guest.hotel, location_code)
    return place(
        guest,
        {
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "location_id": location_id,
            "location_refinement": refinement,
            "delivery_mode": "delivery",
            "timing": "asap",
        },
        key=key,
    )


def _place_id(hotel, code) -> str:
    with tenant_context(hotel):
        return str(Location.objects.get(code=code).pk)


# --- Список мест -------------------------------------------------------------


def test_places_follow_the_matrix_of_the_cart(guest):
    hot = _item(guest, "hot")
    cocktail = _item(guest, "bar-cocktails")

    assert set(_places(guest, hot)) == {"in_room", "pool"}, "кухню у стойки бара не выдают"
    assert set(_places(guest, cocktail)) == {"in_room", "pool", "bar-counter"}
    assert set(_places(guest, hot, cocktail)) == {"in_room", "pool"}, "место — для ВСЕЙ корзины"


def test_each_place_says_how_the_order_is_received(guest):
    places = _places(guest, _item(guest, "bar-cocktails"))
    assert places["bar-counter"]["delivery_mode"] == "pickup"
    assert places["bar-counter"]["kind"] == "pickup_point"
    assert places["in_room"]["delivery_mode"] == "delivery"
    assert places["pool"]["delivery_mode"] == "delivery"


def test_without_a_cart_a_pickup_point_shows_only_if_something_is_handed_out(guest, crystal):
    with tenant_context(crystal):
        Location.objects.create(
            code="empty-counter", kind=Location.Kind.PICKUP_POINT, title={"ru": "Пустая стойка"}
        )
    codes = {entry["code"] for entry in guest.get("/api/guest/locations").json()["locations"]}
    assert "bar-counter" in codes
    assert "empty-counter" not in codes, "у стойки ничего не выдают — гостю её не показываем"


def test_an_unconfigured_category_is_delivered_everywhere_but_not_handed_out(guest, crystal):
    """Без связок категория была заказываемой всегда — и новой проверкой не закрывается."""
    with tenant_context(crystal):
        category = Category.objects.get(code="salads")
        ServiceLocation.all_objects.filter(category=category).hard_delete()
    places = _places(guest, _item(guest, "salads"))
    assert set(places) == {"in_room", "pool"}


def test_a_matrix_change_reaches_the_guest(guest, crystal, cms):
    hot = _item(guest, "hot")
    with tenant_context(crystal):
        category_id = str(Category.objects.get(code="hot").pk)
    saved = cms.put(
        "/api/cms/locations/matrix",
        {"category_id": category_id, "cells": [{"location_id": _place_id(crystal, "pool"), "enabled": False}]},
    )
    assert saved.status_code == 200, saved.content
    assert set(_places(guest, hot)) == {"in_room"}


def test_a_guest_without_a_room_never_gets_the_room(client, crystal):
    response = client.post(
        "/api/guest/session",
        data={"room_number": None},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    anonymous = Guest(client, crystal, response.json()["token"])
    assert "in_room" not in _places(anonymous, _item(anonymous, "bar-cocktails"))


def test_garbage_in_items_is_not_a_500(guest):
    response = guest.get("/api/guest/locations?items=not-a-uuid,,")
    assert response.status_code == 200


# --- Заказ ---------------------------------------------------------------------


def test_an_order_to_a_place_outside_the_matrix_is_refused(guest):
    response = _order(guest, _item(guest, "hot"), "bar-counter", key="matrix-refused")
    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == "location_not_available"
    assert body["field"] == "location_id"
    assert "Горячее" in body["detail"]


def test_an_order_to_a_matching_pickup_point_is_accepted(guest):
    response = _order(guest, _item(guest, "bar-cocktails"), "bar-counter", key="matrix-counter")
    assert response.status_code == 201, response.content
    assert response.json()["location"]["code"] == "bar-counter"


def test_the_order_check_follows_a_matrix_change(guest, crystal, cms):
    with tenant_context(crystal):
        category_id = str(Category.objects.get(code="hot").pk)
    cms.put(
        "/api/cms/locations/matrix",
        {"category_id": category_id, "cells": [{"location_id": _place_id(crystal, "pool"), "enabled": False}]},
    )
    response = _order(guest, _item(guest, "hot"), "pool", key="matrix-pool", refinement="12")
    assert response.status_code == 422
    assert response.json()["code"] == "location_not_available"
