"""
Трекер кухни: доска, действия, авторизация по точке, маршрутизация заказа.

Ключевая проверка прогона — что сотрудник видит и трогает ТОЛЬКО заказы своей
точки исполнения и своего отеля.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.catalog.models import Category, Item, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


def place_guest_order(client, hotel, *, item_code="caesar", key="tracker-1", room="305"):
    """Заказ гостевым потоком — так же, как его создаёт настоящая витрина."""
    token = client.post(
        "/api/guest/session",
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["token"]

    def guest_get(path):
        return client.get(
            path, HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}"
        ).json()

    menu = guest_get("/api/guest/menu")
    item = next(
        entry
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == item_code
    )
    location_id = next(
        entry["id"]
        for entry in guest_get("/api/guest/locations")["locations"]
        if entry["code"] == "in_room"
    )
    response = client.post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "location_id": location_id,
            "timing": "asap",
        },
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert response.status_code == 201, response.content
    return {"token": token, "order": response.json()}


@pytest.fixture
def tracker(cms):
    """Клиент трекера — тот же JWT персонала, что у CMS."""
    return cms


@pytest.fixture
def order(client, crystal, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return place_guest_order(client, crystal)["order"]


# --- Точки -----------------------------------------------------------------


def test_points_lists_only_assigned_ones(tracker, crystal):
    body = tracker.get("/api/tracker/points").json()
    codes = [point["code"] for point in body["points"]]

    # В сиде есть и кухня, и бар, но повар привязан только к кухне.
    assert codes == ["kitchen"]
    assert body["points"][0]["level"] == "lead"
    assert body["points"][0]["sla_minutes"] == 20


def test_points_counters(tracker, order):
    body = tracker.get("/api/tracker/points").json()
    kitchen = body["points"][0]
    assert kitchen["active_count"] == 1
    assert kitchen["new_count"] == 1


def test_staff_without_assignments_sees_no_points(client, crystal, cms):
    """Пустой список — не ошибка: сотрудника просто ещё не назначили."""
    with tenant_context(crystal):
        StaffAssignment.objects.all().delete()

    assert cms.get("/api/tracker/points").json()["points"] == []
    # И доску такой сотрудник открыть не может.
    assert cms.get("/api/tracker/orders?point=kitchen").status_code == 403


# --- Доска -----------------------------------------------------------------


def test_board_columns_come_from_the_hotel_status_preset(tracker, order):
    body = tracker.get("/api/tracker/orders?point=kitchen").json()

    assert body["point"]["code"] == "kitchen"
    assert body["server_time"]
    # Колонки — из пресета отеля, терминальные статусы в активную доску не идут.
    codes = [column["code"] for column in body["columns"]]
    assert codes == ["new", "accepted", "preparing", "on_the_way"]

    new_column = body["columns"][0]
    assert [entry["number"] for entry in new_column["orders"]] == [order["number"]]


def test_board_order_carries_what_the_kitchen_needs(tracker, order):
    card = tracker.get("/api/tracker/orders?point=kitchen").json()["columns"][0]["orders"][0]

    assert card["room"] == "305"
    assert card["location"]["code"] == "in_room"
    assert card["execution_point"]["code"] == "kitchen"
    assert card["assignee"] is None
    assert card["waiting_minutes"] >= 0
    assert card["is_overdue"] is False
    assert card["can_cancel"] is True
    assert card["items"][0]["title"] == "Салат «Цезарь»"
    # Куда можно двинуть — считает сервер: кнопки на карточке обязаны
    # совпадать с тем, что сервер реально примет.
    assert [status["code"] for status in card["next_statuses"]] == [
        "accepted",
        "preparing",
        "on_the_way",
        "done",
    ]


def test_history_scope_holds_finished_orders(tracker, order, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        tracker.post(f"/api/tracker/order/{order['id']}/status", {"status": "done"})

    active = tracker.get("/api/tracker/orders?point=kitchen").json()
    assert all(not column["orders"] for column in active["columns"])

    history = tracker.get("/api/tracker/orders?point=kitchen&scope=history").json()
    assert [entry["number"] for entry in history["columns"][0]["orders"]] == [order["number"]]


def test_board_of_another_point_is_refused(tracker):
    """Повар с кухни не должен видеть доску бара."""
    response = tracker.get("/api/tracker/orders?point=bar")
    assert response.status_code == 403
    assert response.json()["code"] == "point_not_assigned"


def test_unknown_point_is_not_found(tracker):
    assert tracker.get("/api/tracker/orders?point=nowhere").status_code == 404


# --- Действия --------------------------------------------------------------


def test_accept_assigns_the_order_and_moves_status(
    tracker, order, crystal, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = tracker.post(f"/api/tracker/order/{order['id']}/accept", {})

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"]["code"] == "accepted"
    assert body["assignee"]["name"] == "Пётр, повар"
    assert body["accepted_at"]

    with tenant_context(crystal):
        stored = Order.objects.get(pk=order["id"])
        assert stored.assignee is not None
        assert stored.accepted_at is not None


def test_second_accept_is_refused_with_the_current_assignee(
    tracker, order, django_capture_on_commit_callbacks
):
    """
    Два официанта нажимают «Принять» одновременно — обычное дело. Молчаливый
    перехват стал бы неприятным сюрпризом для того, кто уже понёс заказ.
    """
    with django_capture_on_commit_callbacks(execute=True):
        tracker.post(f"/api/tracker/order/{order['id']}/accept", {})

    second = tracker.post(f"/api/tracker/order/{order['id']}/accept", {})
    assert second.status_code == 409
    body = second.json()
    assert body["code"] == "already_accepted"
    assert body["assignee"]["name"] == "Пётр, повар"


def test_status_moves_forward_and_backwards_is_refused(
    tracker, order, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        moved = tracker.post(
            f"/api/tracker/order/{order['id']}/status", {"status": "preparing"}
        )
    assert moved.status_code == 200
    assert moved.json()["status"]["code"] == "preparing"
    # Кто двинул — тот и взял: доска не должна показывать «Готовится» без исполнителя.
    assert moved.json()["assignee"] is not None

    back = tracker.post(f"/api/tracker/order/{order['id']}/status", {"status": "new"})
    assert back.status_code == 422
    assert back.json()["code"] == "invalid_transition"


def test_staff_can_cancel_running_order(tracker, order, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = tracker.post(
            f"/api/tracker/order/{order['id']}/cancel", {"reason": "нет продуктов"}
        )

    assert response.status_code == 200
    assert response.json()["status"]["is_cancelled"] is True

    repeat = tracker.post(f"/api/tracker/order/{order['id']}/cancel", {})
    assert repeat.status_code == 409
    assert repeat.json()["code"] == "cancel_not_allowed"


def test_actions_on_another_points_order_are_refused(tracker, order, crystal):
    """Заказ переехал на бар — кухня теряет к нему доступ."""
    with tenant_context(crystal):
        bar = ExecutionPoint.objects.get(code="bar")
        Order.objects.filter(pk=order["id"]).update(execution_point=bar)

    assert tracker.get(f"/api/tracker/order/{order['id']}").status_code == 403
    assert tracker.post(f"/api/tracker/order/{order['id']}/accept", {}).status_code == 403
    assert (
        tracker.post(f"/api/tracker/order/{order['id']}/status", {"status": "preparing"}).status_code
        == 403
    )


# --- Изоляция отелей -------------------------------------------------------


def test_staff_of_another_hotel_sees_nothing(client, crystal, aurora, cms_aurora, order):
    """Сотрудник Aurora не видит заказ «Кристалла» даже зная его id."""
    board = cms_aurora.get("/api/tracker/orders?point=kitchen").json()
    assert all(not column["orders"] for column in board["columns"])

    assert cms_aurora.get(f"/api/tracker/order/{order['id']}").status_code == 404


def test_guest_token_cannot_reach_the_tracker(client, crystal, guest_token):
    response = client.get(
        "/api/tracker/points",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401


# --- Маршрутизация ---------------------------------------------------------


def test_order_is_routed_by_explicit_route(tracker, order):
    assert order["items"], "заказ создан"
    card = tracker.get(f"/api/tracker/order/{order['id']}").json()
    assert card["execution_point"]["code"] == "kitchen"


def test_category_without_route_falls_back_to_matching_point(
    client, crystal, cms, django_capture_on_commit_callbacks
):
    """
    Категория, только что созданная в CMS, маршрута ещё не имеет — а заказать
    её гость уже может. Молча ронять заказ из-за ненастроенной админки нельзя.
    """
    created = cms.post(
        "/api/cms/categories", {"title": {"ru": "Барная карта", "en": "Bar"}, "code": "bar"}
    ).json()
    cms.post(
        "/api/cms/items",
        {"category_id": created["id"], "title": {"ru": "Мохито"}, "price": 45000},
    )

    with tenant_context(crystal):
        assert not Route.objects.filter(category_id=created["id"]).exists()

    with django_capture_on_commit_callbacks(execute=True):
        placed = place_guest_order(client, crystal, item_code="mohito", key="route-fallback")

    # Соглашение «категория = точка»: категория `bar` ушла на точку `bar`.
    with tenant_context(crystal):
        stored = Order.objects.select_related("execution_point").get(pk=placed["order"]["id"])
        assert stored.execution_point.code == "bar"


def test_single_point_hotel_needs_no_routes(client, crystal, cms, django_capture_on_commit_callbacks):
    """Если исполнитель в отеле один — выбирать не из чего, маршрут не нужен."""
    with tenant_context(crystal):
        ExecutionPoint.objects.filter(code="bar").update(is_active=False)
        Route.objects.all().delete()

    with django_capture_on_commit_callbacks(execute=True):
        placed = place_guest_order(client, crystal, item_code="caesar", key="single-point")

    with tenant_context(crystal):
        stored = Order.objects.select_related("execution_point").get(pk=placed["order"]["id"])
        assert stored.execution_point.code == "kitchen"


def test_no_route_and_several_points_is_an_honest_error(
    client, crystal, cms, django_capture_on_commit_callbacks
):
    with tenant_context(crystal):
        Route.objects.all().delete()
        category = Category.objects.get(code="salads")
        assert not ExecutionPoint.objects.filter(code=category.code).exists()

    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    with tenant_context(crystal):
        item_id = str(Item.objects.get(code="caesar").pk)

    response = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="no-route",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "no_route"
