"""
Самовывоз как сценарий: способ следует из места, плата — только за доставку,
место — у каждой части корзины своё.

До волны 7 способ получения приходил с витрины первым элементом зашитого
списка — всегда «доставка», куда бы гость ни забирал заказ. Плата за доставку
смотрела только на поле локации.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, ServiceLocation
from apps.core.context import tenant_context
from apps.hotels.models import Location
from apps.orders.models import Order
from tests.orders.api.test_guest_service_cart import aggregator, dish_id, guest  # noqa: F401

pytestmark = pytest.mark.django_db


def _place(crystal, code) -> Location:
    with tenant_context(crystal):
        return Location.objects.get(code=code)


@pytest.fixture
def bar_at_counter(crystal, aggregator):  # noqa: F811
    """Напитки бара фикстуры выдают у стойки и несут в номер."""
    with tenant_context(crystal):
        category = Category.objects.get(code="bar-drinks")
        for code in ("in_room", "bar-counter"):
            ServiceLocation.objects.get_or_create(
                category=category, location=Location.objects.get(code=code)
            )
    return aggregator


def _order(call, body, key):
    return call("/api/guest/order", "post", {"timing": "asap", **body}, HTTP_IDEMPOTENCY_KEY=key)


def _set_fee(crystal, code, fee):
    """Мимо формы: у точки выдачи форма плату не примет, а данные бывают всякие."""
    with tenant_context(crystal):
        Location.objects.filter(code=code).update(delivery_fee_minor=fee)


# --- Способ из вида места ------------------------------------------------------


def test_the_mode_follows_the_place_and_ignores_what_the_client_says(client, crystal, bar_at_counter):
    call = guest(client, crystal)
    counter = _place(crystal, "bar-counter")
    in_room = _place(crystal, "in_room")

    picked = _order(
        call,
        {
            "lines": [{"item_id": bar_at_counter["cocktail"], "quantity": 1}],
            "location_id": str(counter.pk),
            "delivery_mode": "delivery",  # старая витрина — сервер не слушает
        },
        key="mode-counter",
    )
    assert picked.status_code == 201, picked.content
    assert picked.json()["delivery_mode"] == "pickup"

    brought = _order(
        call,
        {
            "lines": [{"item_id": bar_at_counter["cocktail"], "quantity": 1}],
            "location_id": str(in_room.pk),
            "delivery_mode": "pickup",
        },
        key="mode-room",
    )
    assert brought.status_code == 201, brought.content
    assert brought.json()["delivery_mode"] == "delivery"


def test_the_mode_is_a_snapshot(client, crystal, bar_at_counter):
    """Смена вида места потом не переписывает, как получали сделанный заказ."""
    call = guest(client, crystal)
    counter = _place(crystal, "bar-counter")
    order_id = _order(
        call,
        {"lines": [{"item_id": bar_at_counter["cocktail"], "quantity": 1}], "location_id": str(counter.pk)},
        key="mode-snapshot",
    ).json()["id"]
    with tenant_context(crystal):
        Location.objects.filter(pk=counter.pk).update(kind=Location.Kind.COMMON_POINT)
        assert Order.objects.get(pk=order_id).delivery_mode == "pickup"


def test_pickup_orders_promise_the_shorter_wait(client, crystal, bar_at_counter):
    call = guest(client, crystal)
    counter = _place(crystal, "bar-counter")
    in_room = _place(crystal, "in_room")
    line = [{"item_id": bar_at_counter["cocktail"], "quantity": 1}]
    picked = _order(call, {"lines": line, "location_id": str(counter.pk)}, key="eta-counter").json()
    brought = _order(call, {"lines": line, "location_id": str(in_room.pk)}, key="eta-room").json()
    assert picked["eta_minutes"] < brought["eta_minutes"]


def test_the_guest_places_list_has_no_hotel_wide_modes(client, crystal):
    body = guest(client, crystal)("/api/guest/locations").json()
    assert "delivery_modes" not in body, "зашитый список способов убран совсем"
    assert all(entry["delivery_mode"] in ("delivery", "pickup") for entry in body["locations"])


# --- Плата за доставку -----------------------------------------------------------


def test_no_delivery_fee_at_a_pickup_point_even_with_a_fee_in_the_row(client, crystal, bar_at_counter):
    _set_fee(crystal, "bar-counter", 30000)
    _set_fee(crystal, "in_room", 25000)
    call = guest(client, crystal)
    line = [{"item_id": bar_at_counter["cocktail"], "quantity": 1}]

    counter_quote = call(
        "/api/guest/cart/quote", "post",
        {"lines": line, "location_id": str(_place(crystal, "bar-counter").pk)},
    ).json()
    room_quote = call(
        "/api/guest/cart/quote", "post",
        {"lines": line, "location_id": str(_place(crystal, "in_room").pk)},
    ).json()
    assert counter_quote["delivery_fee_minor"] == 0
    assert room_quote["delivery_fee_minor"] == 25000, "доставка по-прежнему платная"

    order = _order(
        call, {"lines": line, "location_id": str(_place(crystal, "bar-counter").pk)}, key="fee-counter"
    ).json()
    assert order["charges"]["delivery_fee_minor"] == 0
    assert order["total"] == counter_quote["total_minor"]


# --- Место по каждой части корзины ---------------------------------------------


def test_each_part_of_a_two_venue_cart_gets_its_own_place(client, crystal, bar_at_counter):
    _set_fee(crystal, "in_room", 25000)
    call = guest(client, crystal)
    lines = [
        {"item_id": dish_id(call, bar_at_counter["dish_code"]), "quantity": 1},
        {"item_id": bar_at_counter["cocktail"], "quantity": 1},
    ]
    body = {
        "service_code": "room_service",
        "lines": lines,
        "location_id": str(_place(crystal, "in_room").pk),
        "group_locations": [
            {"point": "bar", "location_id": str(_place(crystal, "bar-counter").pk)}
        ],
    }

    quote = call("/api/guest/cart/quote", "post", body).json()
    executors = {line["executor"]["code"] for line in quote["lines"]}
    assert executors == {"kitchen", "bar"}, "корзина знает, из каких частей состоит"
    assert quote["delivery_fee_minor"] == 25000, "платит только часть, которую несут"

    response = _order(call, body, key="parts")
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        parent = Order.objects.get(pk=response.json()["id"])
        children = {c.execution_point.code: c for c in parent.children.select_related("location", "execution_point")}
        assert children["kitchen"].location.code == "in_room"
        assert children["kitchen"].delivery_mode == "delivery"
        assert children["bar"].location.code == "bar-counter"
        assert children["bar"].delivery_mode == "pickup"
        assert parent.location_id is None, "у агрегата общего места нет"
        assert parent.delivery_fee_minor == 25000


def test_one_place_for_the_whole_cart_is_asked_once(client, crystal, bar_at_counter):
    call = guest(client, crystal)
    in_room = _place(crystal, "in_room")
    response = _order(
        call,
        {
            "service_code": "room_service",
            "lines": [
                {"item_id": dish_id(call, bar_at_counter["dish_code"]), "quantity": 1},
                {"item_id": bar_at_counter["cocktail"], "quantity": 1},
            ],
            "location_id": str(in_room.pk),
        },
        key="one-place",
    )
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        parent = Order.objects.get(pk=response.json()["id"])
        assert parent.location_id == in_room.pk
        assert {c.location_id for c in parent.children.all()} == {in_room.pk}


def test_a_part_is_checked_against_the_matrix_on_its_own(client, crystal, bar_at_counter):
    """Кухню к стойке бара не выдают — даже если коктейли туда можно."""
    call = guest(client, crystal)
    response = _order(
        call,
        {
            "service_code": "room_service",
            "lines": [
                {"item_id": dish_id(call, bar_at_counter["dish_code"]), "quantity": 1},
                {"item_id": bar_at_counter["cocktail"], "quantity": 1},
            ],
            "location_id": str(_place(crystal, "in_room").pk),
            "group_locations": [
                {"point": "kitchen", "location_id": str(_place(crystal, "bar-counter").pk)}
            ],
        },
        key="part-refused",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "location_not_available"
