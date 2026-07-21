"""Гостевая витрина: сессия, меню, карточка, локации, заказ, история, отмена."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.models import Order

from .conftest import host_for


pytestmark = pytest.mark.django_db


class Guest:
    """Гостевой клиент: подставляет хост отеля и токен сессии."""

    def __init__(self, client, hotel, token: str):
        self.client = client
        self.hotel = hotel
        self.token = token

    def _kw(self, extra=None):
        kwargs = {"HTTP_HOST": host_for(self.hotel)}
        if self.token:
            kwargs["HTTP_AUTHORIZATION"] = f"Bearer {self.token}"
        kwargs.update(extra or {})
        return kwargs

    def get(self, path, **extra):
        return self.client.get(path, **self._kw(extra))

    def post(self, path, data=None, **extra):
        return self.client.post(
            path, data=data or {}, content_type="application/json", **self._kw(extra)
        )


def open_session(client, hotel, room_number="305"):
    response = client.post(
        "/api/guest/session",
        data={"room_number": room_number},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    return response


@pytest.fixture
def guest(client, crystal):
    response = open_session(client, crystal)
    assert response.status_code == 200, response.content
    return Guest(client, crystal, response.json()["token"])


@pytest.fixture
def anonymous_guest(client, crystal):
    """Сессия без номера — «просто посмотреть»."""
    response = client.post(
        "/api/guest/session",
        data={"room_number": None},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert response.status_code == 200
    return Guest(client, crystal, response.json()["token"])


# --- Сессия ----------------------------------------------------------------


def test_session_returns_brand_and_room(client, crystal):
    body = open_session(client, crystal).json()

    assert body["room"] == "305"
    assert body["trust"] == "room_scanned"
    assert body["hotel"]["name"] == "Отель «Кристалл»"
    assert body["hotel"]["currency_minor_units"] == 2
    assert [lang["code"] for lang in body["hotel"]["languages"]] == ["ru", "en", "ar", "zh"]
    # Тема отеля едет вместе с сессией: витрина красится ещё до первого экрана.
    assert body["hotel"]["theme"]["palette"]["light"]["primary"]


def test_unknown_room_leads_to_manual_entry_not_to_an_error_page(client, crystal):
    """
    Старый QR или опечатка — развилка сценария, а не сбой. Ответ обязан нести
    бренд отеля, иначе гость упрётся в голую системную страницу.
    """
    response = open_session(client, crystal, room_number="999")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "room_not_found"
    assert body["hint"] == "manual_entry"
    assert body["hotel"]["name"] == "Отель «Кристалл»"


def test_session_without_room_is_anonymous(anonymous_guest):
    body = anonymous_guest.get("/api/guest/session").json()
    assert body["trust"] == "anonymous"
    assert body["room"] is None
    assert body["token"] is None, "повторно токен не отдаём"


# --- Меню ------------------------------------------------------------------


def test_menu_is_localized_and_carries_server_time(guest):
    body = guest.get("/api/guest/menu", HTTP_ACCEPT_LANGUAGE="en").json()
    titles = {c["code"]: c["title"] for c in body["categories"]}
    assert titles["hot"] == "Hot dishes"
    # Время отеля нужно витрине, чтобы считать «осталось 20 минут» без веры в
    # часы телефона.
    assert body["server_time"]


def test_menu_marks_unavailable_items_instead_of_hiding_them(guest, crystal):
    """Гостю полезнее увидеть «завтрак с 07:00», чем пустой раздел."""
    with tenant_context(crystal):
        item = Item.objects.get(code="ribeye")
        item.in_stock = False
        item.save(update_fields=["in_stock"])

    menu = guest.get("/api/guest/menu").json()
    ribeye = next(
        entry
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "ribeye"
    )
    assert ribeye["is_available"] is False
    assert ribeye["unavailable_reason"] == "out_of_stock"


def test_menu_flags_items_with_required_modifiers(guest):
    menu = guest.get("/api/guest/menu").json()
    by_code = {
        entry["code"]: entry
        for category in menu["categories"]
        for entry in category["items"]
    }
    assert by_code["ribeye"]["has_required_modifiers"] is True
    assert by_code["caesar"]["has_modifiers"] is False


def test_item_detail_returns_modifier_groups(guest):
    menu = guest.get("/api/guest/menu").json()
    steak_id = next(
        entry["id"]
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "ribeye"
    )

    detail = guest.get(f"/api/guest/item/{steak_id}").json()
    assert detail["category_title"] == "Горячее"
    doneness = next(g for g in detail["modifier_groups"] if g["code"] == "doneness")
    assert doneness["is_required"] is True
    assert doneness["selection"] == "single"
    assert any(option["is_default"] for option in doneness["options"])


def test_item_detail_is_scoped_to_the_hotel(guest, cms_aurora):
    foreign_id = cms_aurora.get("/api/cms/items").json()[0]["id"]
    assert guest.get(f"/api/guest/item/{foreign_id}").status_code == 404


# --- Локации ---------------------------------------------------------------


def test_locations_default_to_the_room(guest):
    body = guest.get("/api/guest/locations").json()
    assert body["room"] == "305"

    by_code = {entry["code"]: entry for entry in body["locations"]}
    assert by_code["in_room"]["is_default"] is True
    assert by_code["pool"]["requires_refinement"] is True
    assert by_code["pool"]["refinement_label"] == "Номер шезлонга"


def test_guest_without_room_gets_no_in_room_option(anonymous_guest):
    """Доставлять в номер некуда, если номера нет."""
    body = anonymous_guest.get("/api/guest/locations").json()
    assert "in_room" not in {entry["code"] for entry in body["locations"]}


# --- Заказ -----------------------------------------------------------------


def order_body(guest, *, item_code="caesar", **overrides):
    menu = guest.get("/api/guest/menu").json()
    item = next(
        entry
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == item_code
    )
    option_ids = []
    if item["has_required_modifiers"]:
        detail = guest.get(f"/api/guest/item/{item['id']}").json()
        for group in detail["modifier_groups"]:
            if group["is_required"]:
                option_ids.append(group["options"][0]["id"])

    location_id = next(
        entry["id"]
        for entry in guest.get("/api/guest/locations").json()["locations"]
        if entry["code"] == "in_room"
    )
    return {
        "lines": [{"item_id": item["id"], "quantity": 1, "modifier_option_ids": option_ids}],
        "location_id": location_id,
        "delivery_mode": "delivery",
        "timing": "asap",
        "comment": "",
        **overrides,
    }


def place(guest, body, key="order-1"):
    return guest.post("/api/guest/order", body, HTTP_IDEMPOTENCY_KEY=key)


def test_order_full_object(guest, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = place(guest, order_body(guest, item_code="ribeye"))
    assert response.status_code == 201, response.content

    body = response.json()
    assert body["number"] == 1
    assert body["room"] == "305"
    assert body["location"]["code"] == "in_room"
    assert body["status"]["code"] == "new"
    assert body["status"]["allows_guest_cancel"] is True
    # Пресет и история едут вместе с заказом: таймлайн рисуется без второго
    # запроса и без знания пресета статусов на клиенте.
    assert [status["code"] for status in body["status_flow"]][:2] == ["new", "accepted"]
    assert [entry["code"] for entry in body["history"]] == ["new"]
    assert body["eta_minutes"] == 25
    assert body["items"][0]["modifiers"][0]["title"] == "С кровью"


def test_order_requires_a_room(anonymous_guest):
    """Заказ без номера некуда доставить — смотреть меню при этом можно."""
    body = {
        "lines": [{"item_id": "00000000-0000-0000-0000-000000000000", "quantity": 1}],
        "timing": "asap",
    }
    response = place(anonymous_guest, body, key="anon-1")
    assert response.status_code == 403
    assert response.json()["code"] == "trust_required"


def test_unavailable_item_cannot_be_ordered(guest, crystal):
    """Ровно тот же расчёт, что показывает меню, блокирует и заказ."""
    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        item.in_stock = False
        item.save(update_fields=["in_stock"])

    response = place(guest, order_body(guest))
    assert response.status_code == 422
    assert response.json()["code"] == "item_unavailable"


def test_refinement_is_required_for_common_points(guest):
    pool_id = next(
        entry["id"]
        for entry in guest.get("/api/guest/locations").json()["locations"]
        if entry["code"] == "pool"
    )
    response = place(guest, order_body(guest, location_id=pool_id))
    assert response.status_code == 422
    assert response.json()["code"] == "refinement_required"

    ok = place(
        guest,
        order_body(guest, location_id=pool_id, location_refinement="12"),
        key="pool-ok",
    )
    assert ok.status_code == 201
    assert ok.json()["location"]["refinement"] == "12"


@pytest.mark.parametrize(
    "delta,label",
    [(timedelta(hours=-2), "время в прошлом"), (timedelta(days=2), "дальше суток")],
)
def test_scheduled_time_is_validated(guest, delta, label):
    body = order_body(
        guest,
        timing="scheduled",
        requested_time=(timezone.now() + delta).isoformat(),
    )
    response = place(guest, body, key=f"sched-{label}")
    assert response.status_code == 422, label
    assert response.json()["code"] == "requested_time_invalid"


def test_scheduled_order_reports_time_until_it(guest):
    body = order_body(
        guest,
        timing="scheduled",
        requested_time=(timezone.now() + timedelta(minutes=90)).isoformat(),
    )
    response = place(guest, body, key="sched-ok")
    assert response.status_code == 201
    # Для заказа ко времени честнее показать, сколько до него осталось, чем
    # среднюю длительность приготовления.
    assert 85 <= response.json()["eta_minutes"] <= 90


def test_repeat_submission_does_not_duplicate_the_order(guest, crystal):
    body = order_body(guest)
    first = place(guest, body, key="retry-1")
    second = place(guest, body, key="retry-1")

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    with tenant_context(crystal):
        assert Order.objects.count() == 1


# --- История и отмена ------------------------------------------------------


def test_orders_are_split_into_active_and_past(guest, crystal, django_capture_on_commit_callbacks):
    order_id = place(guest, order_body(guest), key="hist-1").json()["id"]

    listing = guest.get("/api/guest/orders").json()
    assert [entry["id"] for entry in listing["active"]] == [order_id]
    assert listing["past"] == []

    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        with django_capture_on_commit_callbacks(execute=True):
            change_status(get_order(order_id), to_code="done", actor_type="staff")

    listing = guest.get("/api/guest/orders").json()
    assert listing["active"] == []
    assert [entry["id"] for entry in listing["past"]] == [order_id]


def test_guest_can_cancel_while_the_status_allows_it(guest, crystal, django_capture_on_commit_callbacks):
    order_id = place(guest, order_body(guest), key="cancel-1").json()["id"]

    with django_capture_on_commit_callbacks(execute=True):
        cancelled = guest.post(f"/api/guest/order/{order_id}/cancel", {"reason": "передумал"})
    assert cancelled.status_code == 200
    body = cancelled.json()
    assert body["status"]["code"] == "cancelled"
    assert body["status"]["is_cancelled"] is True


def test_cancel_is_refused_once_the_kitchen_started(guest, crystal, django_capture_on_commit_callbacks):
    """
    Между отрисовкой экрана и нажатием кнопки кухня успевает взять заказ в
    работу — поэтому проверку делает сервер, даже если кнопки в UI уже нет.
    """
    order_id = place(guest, order_body(guest), key="cancel-2").json()["id"]

    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        with django_capture_on_commit_callbacks(execute=True):
            change_status(get_order(order_id), to_code="preparing", actor_type="staff")

    response = guest.post(f"/api/guest/order/{order_id}/cancel", {})
    assert response.status_code == 409
    assert response.json()["code"] == "cancel_not_allowed"


def test_guest_sees_only_own_orders(client, crystal, guest):
    order_id = place(guest, order_body(guest), key="own-1").json()["id"]

    other = open_session(client, crystal, room_number="201").json()
    stranger = Guest(client, crystal, other["token"])

    assert stranger.get(f"/api/guest/order/{order_id}").status_code == 404
    assert stranger.get("/api/guest/orders").json()["active"] == []


# --- Смена статуса персоналом ----------------------------------------------


def test_staff_status_endpoint_moves_the_order(guest, cms, django_capture_on_commit_callbacks):
    order_id = place(guest, order_body(guest), key="staff-1").json()["id"]

    with django_capture_on_commit_callbacks(execute=True):
        response = cms.post(f"/api/orders/{order_id}/status", {"status": "preparing"})
    assert response.status_code == 200
    assert response.json()["status"]["code"] == "preparing"

    # И гость видит это же состояние через свой эндпоинт.
    assert guest.get(f"/api/guest/order/{order_id}").json()["status"]["code"] == "preparing"


def test_status_endpoint_is_closed_to_guests(guest):
    order_id = place(guest, order_body(guest), key="staff-2").json()["id"]
    response = guest.post(f"/api/orders/{order_id}/status", {"status": "preparing"})
    assert response.status_code == 401


def test_terminal_order_cannot_be_moved(guest, cms, django_capture_on_commit_callbacks):
    order_id = place(guest, order_body(guest), key="staff-3").json()["id"]

    with django_capture_on_commit_callbacks(execute=True):
        cms.post(f"/api/orders/{order_id}/status", {"status": "done"})

    response = cms.post(f"/api/orders/{order_id}/status", {"status": "preparing"})
    assert response.status_code == 409
    assert response.json()["code"] == "order_finished"
