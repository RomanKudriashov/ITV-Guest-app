"""
Второй тип предложения: заявка-услуга.

Это прежде всего архитектурная проверка. Заявка обязана пройти по ТОМУ ЖЕ
пути, что и еда: тот же эндпоинт заказа, тот же объект Order, тот же трекер,
тот же живой статус. Поэтому тесты здесь не столько про «услуги работают»,
сколько про «услуги не потребовали второго кода».
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item, RequestField
from apps.core.context import tenant_context
from apps.orders.models import Order

from .conftest import host_for, staff_token_for

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


class Guest:
    def __init__(self, client, hotel, token):
        self.client, self.hotel, self.token = client, hotel, token

    def _kw(self, extra=None):
        kwargs = {
            "HTTP_HOST": host_for(self.hotel),
            "HTTP_AUTHORIZATION": f"Bearer {self.token}",
        }
        kwargs.update(extra or {})
        return kwargs

    def get(self, path, **extra):
        return self.client.get(path, **self._kw(extra))

    def post(self, path, data=None, **extra):
        return self.client.post(
            path, data=data or {}, content_type="application/json", **self._kw(extra)
        )


@pytest.fixture
def guest(client, crystal):
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    return Guest(client, crystal, token)


@pytest.fixture
def taxi(guest):
    catalog = guest.get("/api/guest/catalog?type=service_request").json()
    return next(
        entry
        for category in catalog["categories"]
        for entry in category["items"]
        if entry["code"] == "taxi"
    )


def taxi_order(taxi, **overrides):
    values = {
        "destination": "Аэропорт Пулково",
        "when": "18:30",
        "passengers": 3,
        **overrides.pop("field_values", {}),
    }
    return {
        "lines": [{"item_id": taxi["id"], "quantity": 1}],
        "timing": "asap",
        "field_values": values,
        **overrides,
    }


def place(guest, body, key):
    return guest.post("/api/guest/order", body, HTTP_IDEMPOTENCY_KEY=key)


def tracker_for(client, hotel, login: str):
    token = client.post(
        "/api/staff/auth/login",
        data={"email": f"{login}@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["access"]

    def request(path, method="get", data=None):
        kwargs = {"HTTP_HOST": host_for(hotel), "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if method == "get":
            return client.get(path, **kwargs)
        return client.post(path, data=data or {}, content_type="application/json", **kwargs)

    return request


# --- Витрина ---------------------------------------------------------------


def test_catalog_serves_both_types_through_one_endpoint(guest):
    food = guest.get("/api/guest/catalog?type=product").json()
    services = guest.get("/api/guest/catalog?type=service_request").json()

    assert {c["code"] for c in food["categories"]} >= {"hot", "salads", "drinks"}
    assert {c["code"] for c in services["categories"]} == {"transfer", "housekeeping"}
    # Конверт один и тот же — различается только содержимое.
    assert food.keys() == services.keys()


def test_menu_alias_still_returns_only_food(guest):
    """Старый /menu не должен внезапно начать отдавать такси."""
    menu = guest.get("/api/guest/menu").json()
    codes = {i["code"] for c in menu["categories"] for i in c["items"]}
    assert "taxi" not in codes
    assert "ribeye" in codes


def test_service_item_detail_carries_fields_instead_of_modifiers(guest, taxi):
    detail = guest.get(f"/api/guest/item/{taxi['id']}").json()

    assert detail["type"] == "service_request"
    assert detail["price"] is None, "«цена не указана» — это null, а не ноль"
    assert detail["location_mode"] == "none"
    assert detail["modifier_groups"] == []

    by_code = {entry["code"]: entry for entry in detail["request_fields"]}
    assert by_code["destination"]["field_type"] == "text"
    assert by_code["passengers"]["min_value"] == 1 and by_code["passengers"]["max_value"] == 8
    assert [option["label"] for option in by_code["car_class"]["options"]] == [
        "Эконом",
        "Комфорт",
        "Минивэн",
    ]


def test_food_item_detail_has_empty_field_block(guest):
    """Оба блока приезжают всегда: клиент смотрит на содержимое, не на тип."""
    menu = guest.get("/api/guest/menu").json()
    steak = next(
        i for c in menu["categories"] for i in c["items"] if i["code"] == "ribeye"
    )
    detail = guest.get(f"/api/guest/item/{steak['id']}").json()

    assert detail["request_fields"] == []
    assert detail["modifier_groups"]


# --- Создание заявки -------------------------------------------------------


def test_service_request_goes_through_the_same_order_endpoint(guest, taxi, crystal):
    response = place(guest, taxi_order(taxi, field_values={"car_class": "comfort"}), "svc-1")
    assert response.status_code == 201, response.content

    body = response.json()
    assert body["type"] == "request"
    assert body["total"] is None, "у услуги без цены нет суммы, а не ноль"
    assert body["location"] is None
    assert body["status"]["code"] == "new"

    # Позиция у заявки есть — на ней держатся маршрут, снапшот и доступность.
    assert [entry["title"] for entry in body["items"]] == ["Такси"]
    assert body["items"][0]["unit_price"] is None

    assert [(f["label"], f["display"]) for f in body["field_values"]] == [
        ("Куда", "Аэропорт Пулково"),
        ("Когда подать", "18:30"),
        ("Сколько человек", "3"),
        ("Класс машины", "Комфорт"),
    ]

    with tenant_context(crystal):
        stored = Order.objects.get(pk=body["id"])
        assert stored.type == Order.Type.REQUEST
        assert stored.execution_point.code == "concierge"


def test_service_request_is_routed_to_its_department(guest, taxi, crystal):
    place(guest, taxi_order(taxi), "svc-route")

    with tenant_context(crystal):
        cleaning = Item.objects.get(code="cleaning")

    response = place(
        guest,
        {
            "lines": [{"item_id": str(cleaning.pk), "quantity": 1}],
            "timing": "asap",
            "field_values": {"when": "11:00"},
        },
        "svc-clean",
    )
    assert response.status_code == 201, response.content

    with tenant_context(crystal):
        assert Order.objects.get(pk=response.json()["id"]).execution_point.code == "housekeeping"


# --- Валидация полей -------------------------------------------------------


def test_required_field_is_enforced_by_the_server(guest, taxi):
    response = place(guest, taxi_order(taxi, field_values={"when": None}), "svc-req")
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "field_required"
    assert body["field"] == "when"


@pytest.mark.parametrize(
    "values,code",
    [
        ({"passengers": 20}, "field_out_of_range"),
        ({"passengers": 0}, "field_out_of_range"),
        ({"passengers": "трое"}, "field_invalid"),
        ({"when": "25:00"}, "field_invalid"),
        ({"car_class": "helicopter"}, "field_invalid"),
    ],
)
def test_field_values_are_validated_by_type(guest, taxi, values, code):
    response = place(guest, taxi_order(taxi, field_values=values), f"svc-{code}-{values}")
    assert response.status_code == 422, response.content
    assert response.json()["code"] == code


def test_unknown_field_is_rejected(guest, taxi):
    response = place(guest, taxi_order(taxi, field_values={"colour": "red"}), "svc-unknown")
    assert response.status_code == 422
    assert response.json()["code"] == "field_unknown"


def test_optional_field_may_be_omitted(guest, taxi):
    """car_class необязателен — заявка без него валидна."""
    response = place(guest, taxi_order(taxi), "svc-optional")
    assert response.status_code == 201
    assert "car_class" not in {f["code"] for f in response.json()["field_values"]}


# --- Правила из реестра поведений ------------------------------------------


def test_fields_are_rejected_for_products(guest):
    menu = guest.get("/api/guest/menu").json()
    caesar = next(i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")

    response = place(
        guest,
        {
            "lines": [{"item_id": caesar["id"], "quantity": 1}],
            "timing": "asap",
            "field_values": {"destination": "куда-нибудь"},
        },
        "svc-wrongtype",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "fields_not_supported"


def test_modifiers_are_rejected_for_services(guest, taxi):
    body = taxi_order(taxi)
    body["lines"][0]["modifier_option_ids"] = ["00000000-0000-0000-0000-000000000000"]

    response = place(guest, body, "svc-mods")
    assert response.status_code == 422
    assert response.json()["code"] == "modifiers_not_supported"


def test_service_request_allows_only_one_line(guest, taxi, crystal):
    with tenant_context(crystal):
        cleaning = Item.objects.get(code="cleaning")

    body = taxi_order(taxi)
    body["lines"].append({"item_id": str(cleaning.pk), "quantity": 1})

    response = place(guest, body, "svc-two")
    assert response.status_code == 422
    assert response.json()["code"] == "single_line_only"


def test_food_and_services_cannot_be_mixed(guest, taxi):
    menu = guest.get("/api/guest/menu").json()
    caesar = next(i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")

    body = taxi_order(taxi)
    body["lines"].append({"item_id": caesar["id"], "quantity": 1})

    response = place(guest, body, "svc-mixed")
    assert response.status_code == 422
    assert response.json()["code"] in {"single_line_only", "mixed_offering_types"}


def test_location_is_not_asked_where_it_makes_no_sense(guest, taxi):
    """У такси точка подачи — поле заявки, локация доставки тут бессмысленна."""
    locations = guest.get("/api/guest/locations").json()["locations"]
    in_room = next(entry["id"] for entry in locations if entry["code"] == "in_room")

    response = place(guest, taxi_order(taxi, location_id=in_room), "svc-loc")
    assert response.status_code == 422
    assert response.json()["code"] == "location_not_supported"


# --- Трекер: та же доска, другое тело --------------------------------------


def test_departments_see_only_their_own_orders(client, crystal, guest, taxi):
    """Кухня не видит такси, консьерж не видит еду — обычная работа Route."""
    place(guest, taxi_order(taxi), "svc-board")

    menu = guest.get("/api/guest/menu").json()
    caesar = next(i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    location_id = next(
        entry["id"]
        for entry in guest.get("/api/guest/locations").json()["locations"]
        if entry["code"] == "in_room"
    )
    place(
        guest,
        {
            "lines": [{"item_id": caesar["id"], "quantity": 1}],
            "location_id": location_id,
            "timing": "asap",
        },
        "food-board",
    )

    concierge = tracker_for(client, crystal, "concierge")
    kitchen = tracker_for(client, crystal, "chef")

    concierge_board = concierge("/api/tracker/orders?point=concierge").json()
    kitchen_board = kitchen("/api/tracker/orders?point=kitchen").json()

    concierge_types = {o["type"] for c in concierge_board["columns"] for o in c["orders"]}
    kitchen_types = {o["type"] for c in kitchen_board["columns"] for o in c["orders"]}

    assert concierge_types == {"request"}
    assert kitchen_types == {"cart"}


def test_tracker_card_shows_fields_for_a_request(client, crystal, guest, taxi):
    place(guest, taxi_order(taxi), "svc-card")
    concierge = tracker_for(client, crystal, "concierge")

    board = concierge("/api/tracker/orders?point=concierge").json()
    card = board["columns"][0]["orders"][0]

    # Тот же конверт, что у еды: отличается только наполнение тела.
    assert card["execution_point"]["code"] == "concierge"
    assert card["can_cancel"] is True
    assert [status["code"] for status in card["next_statuses"]][0] == "accepted"
    assert [(f["label"], f["display"]) for f in card["field_values"]][0] == (
        "Куда",
        "Аэропорт Пулково",
    )


def test_request_moves_through_statuses_like_any_order(
    client, crystal, guest, taxi, django_capture_on_commit_callbacks
):
    order_id = place(guest, taxi_order(taxi), "svc-flow").json()["id"]
    concierge = tracker_for(client, crystal, "concierge")

    with django_capture_on_commit_callbacks(execute=True):
        accepted = concierge(f"/api/tracker/order/{order_id}/accept", "post")
    assert accepted.status_code == 200
    assert accepted.json()["assignee"]["name"] == "Анна, консьерж"

    with django_capture_on_commit_callbacks(execute=True):
        moved = concierge(
            f"/api/tracker/order/{order_id}/status", "post", {"status": "preparing"}
        )
    assert moved.status_code == 200

    # И гость видит это своим обычным эндпоинтом.
    guest_view = guest.get(f"/api/guest/order/{order_id}").json()
    assert guest_view["status"]["code"] == "preparing"
    assert guest_view["field_values"][0]["display"] == "Аэропорт Пулково"


def test_guest_history_mixes_both_types(guest, taxi):
    place(guest, taxi_order(taxi), "svc-hist")

    menu = guest.get("/api/guest/menu").json()
    caesar = next(i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    place(
        guest,
        {"lines": [{"item_id": caesar["id"], "quantity": 1}], "timing": "asap"},
        "food-hist",
    )

    active = guest.get("/api/guest/orders").json()["active"]
    assert {entry["type"] for entry in active} == {"request", "cart"}


# --- CMS -------------------------------------------------------------------


def test_cms_creates_a_service_with_fields(cms, crystal):
    category = cms.post(
        "/api/cms/categories",
        {"type": "service_request", "title": {"ru": "Прачечная", "en": "Laundry"}},
    ).json()

    item = cms.post(
        "/api/cms/items",
        {
            "category_id": category["id"],
            "type": "service_request",
            "title": {"ru": "Стирка", "en": "Laundry"},
            "price": None,
        },
    )
    assert item.status_code == 201, item.content
    body = item.json()
    assert body["type"] == "service_request"
    assert body["price"] is None
    # Режим локации подставился из реестра поведений.
    assert body["location_mode"] == "room"

    field = cms.post(
        f"/api/cms/items/{body['id']}/request-fields",
        {
            "label": {"ru": "Когда забрать", "en": "Pickup time"},
            "field_type": "time",
            "is_required": True,
        },
    )
    assert field.status_code == 201, field.content
    assert field.json()["code"] == "pickup-time"

    detail = cms.get(f"/api/cms/items/{body['id']}").json()
    assert [entry["code"] for entry in detail["request_fields"]] == ["pickup-time"]
    assert detail["modifier_groups"] == []


def test_cms_category_tree_is_filtered_by_type(cms):
    food = cms.get("/api/cms/categories?type=product").json()
    services = cms.get("/api/cms/categories?type=service_request").json()

    food_codes = {node["code"] for node in food}
    assert {"hot", "salads", "drinks"} <= food_codes
    assert food_codes.isdisjoint({"transfer", "housekeeping"})
    assert {node["code"] for node in services} == {"transfer", "housekeeping"}


def test_cms_item_type_cannot_be_changed(cms, crystal):
    with tenant_context(crystal):
        taxi_id = str(Item.objects.get(code="taxi").pk)

    response = cms.patch(f"/api/cms/items/{taxi_id}", {"type": "product"})
    assert response.status_code == 422
    assert response.json()["code"] == "type_immutable"


@pytest.mark.parametrize(
    "payload,code",
    [
        ({"label": {"ru": "Класс"}, "field_type": "select", "options": []}, "select_without_options"),
        (
            {"label": {"ru": "Сколько"}, "field_type": "count", "min_value": 5, "max_value": 2},
            "invalid_range",
        ),
        (
            {"label": {"ru": "Адрес"}, "field_type": "text", "min_value": 1},
            "validation_error",
        ),
    ],
)
def test_cms_request_field_validation(cms, crystal, payload, code):
    with tenant_context(crystal):
        taxi_id = str(Item.objects.get(code="taxi").pk)

    response = cms.post(f"/api/cms/items/{taxi_id}/request-fields", payload)
    assert response.status_code == 422, response.content
    assert response.json()["code"] == code


def test_cms_refuses_fields_on_a_product(cms, crystal):
    with tenant_context(crystal):
        steak_id = str(Item.objects.get(code="ribeye").pk)

    response = cms.post(
        f"/api/cms/items/{steak_id}/request-fields",
        {"label": {"ru": "Куда"}, "field_type": "text"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "fields_not_supported"


def test_cms_reorders_and_deletes_fields(cms, crystal):
    with tenant_context(crystal):
        taxi_id = str(Item.objects.get(code="taxi").pk)

    fields = cms.get(f"/api/cms/items/{taxi_id}").json()["request_fields"]
    reversed_ids = list(reversed([entry["id"] for entry in fields]))

    reordered = cms.post(
        f"/api/cms/items/{taxi_id}/request-fields/reorder",
        {"items": [{"id": fid, "sort_order": index} for index, fid in enumerate(reversed_ids)]},
    )
    assert reordered.status_code == 200
    assert [entry["id"] for entry in reordered.json()] == reversed_ids

    assert cms.delete(f"/api/cms/request-fields/{reversed_ids[0]}").status_code == 200
    with tenant_context(crystal):
        assert RequestField.objects.filter(pk=reversed_ids[0]).count() == 0


# --- Изоляция тенантов -----------------------------------------------------


def test_services_are_isolated_between_hotels(cms, cms_aurora):
    crystal_services = cms.get("/api/cms/items?type=service_request").json()
    aurora_services = cms_aurora.get("/api/cms/items?type=service_request").json()

    assert crystal_services and aurora_services
    assert {i["id"] for i in crystal_services}.isdisjoint({i["id"] for i in aurora_services})
