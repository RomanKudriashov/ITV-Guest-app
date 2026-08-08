"""
Посервисная корзина гостя (R5).

R2 построил разъезд заказа, но снял с себя отклонение: клиент не слал
`service_code`, поэтому РЕАЛЬНЫЕ заказы оставались плоскими, а fan-out жил
только в фикстурах. R5 закрывает это со стороны витрины, и здесь проверяется
то же самое со стороны API — гостевым потоком, а не прямым вызовом сервиса.

Главное утверждение: заказ, оформленный в заведении-агрегаторе, разъезжается
по исполнителям так же, как это делала фикстура R2/R3 — иначе «оживление»
было бы только на словах.
"""

from __future__ import annotations

import pytest

from apps.catalog.services import inclusions as inc_svc
from apps.catalog.models import Category, Item, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service
from apps.orders.models import Order

from .conftest import host_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def aggregator(crystal):
    """
    Рум-сервис, включающий кухню и бар по ссылке. Ровно та расстановка, на
    которой R2 показывал разъезд — но заказ ниже придёт гостевым эндпоинтом.
    """
    with tenant_context(crystal):
        kitchen = Service.objects.get(execution_point__code="kitchen")

        bar_point = ExecutionPoint.objects.get(code="bar")
        bar = Service.objects.get(execution_point=bar_point)
        bar_category = Category.objects.create(
            code="bar-drinks", type="product", title={"ru": "Напитки бара"}, service=bar
        )
        Route.objects.create(category=bar_category, execution_point=bar_point)
        # Код фикстуры НЕ должен совпадать с кодом сидового блюда: у бара
        # теперь есть своя карта, и «negroni» там настоящий. Тестовые данные не
        # занимают имена продуктовых — иначе сид и фикстура дерутся за
        # уникальность кода, и падает не тот, кто виноват.
        cocktail = Item.objects.create(
            code="negroni-fanout-fixture", category=bar_category, type="product",
            title={"ru": "Негрони"}, price=65000,
        )

        rs_point = ExecutionPoint.objects.create(
            code="room_service", title={"ru": "Рум-сервис"}, kind=ExecutionPoint.Kind.KITCHEN
        )
        room_service = Service.objects.create(
            execution_point=rs_point, code="room_service",
            type=Service.Type.ROOM_SERVICE, public_name={"ru": "Рум-сервис"},
        )
        inc_svc.create_inclusion(room_service.pk, {"source_service_id": str(kitchen.pk)})
        inc_svc.create_inclusion(room_service.pk, {"source_service_id": str(bar.pk)})

        return {"cocktail": str(cocktail.pk), "dish_code": "caesar"}


def guest(client, crystal, room="305"):
    token = client.post(
        "/api/guest/session",
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]

    def call(path, method="get", body=None, **extra):
        kwargs = {
            "HTTP_HOST": host_for(crystal),
            "HTTP_AUTHORIZATION": f"Bearer {token}",
            **extra,
        }
        if method == "post":
            return client.post(path, data=body or {}, content_type="application/json", **kwargs)
        return client.get(path, **kwargs)

    return call


def dish_id(call, code: str) -> str:
    menu = call("/api/guest/catalog?type=product").json()
    return next(
        item["id"]
        for category in menu["categories"]
        for item in category["items"]
        if item["code"] == code
    )


# --- Главное: реальный заказ разъезжается ----------------------------------


def test_guest_order_in_the_aggregator_fans_out(client, crystal, aggregator):
    """
    Гость взял блюдо кухни и коктейль бара в рум-сервисе — заказ разъехался
    на двух исполнителей. До R5 этот же заказ приходил плоским.
    """
    call = guest(client, crystal)
    response = call(
        "/api/guest/order",
        "post",
        {
            "service_code": "room_service",
            "lines": [
                {"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1},
                {"item_id": aggregator["cocktail"], "quantity": 1},
            ],
            "timing": "asap",
        },
        HTTP_IDEMPOTENCY_KEY="r5-fanout",
    )
    assert response.status_code == 201, response.content
    parent_id = response.json()["id"]

    with tenant_context(crystal):
        parent = Order.objects.get(pk=parent_id)
        children = list(parent.children.select_related("execution_point"))

        assert len(children) == 2, "заказ обязан разъехаться на двух исполнителей"
        assert {child.execution_point.code for child in children} == {"kitchen", "bar"}
        # Деньги — один снимок на parent, как в R2: children их не несут.
        assert parent.total is not None
        assert all(child.total is None for child in children)


def test_same_order_without_service_code_stays_flat(client, crystal, aggregator):
    """
    Обратная сторона: без кода заведения разъезда нет. Это и было поведением
    до R5 — тест фиксирует, что именно код заведения его включает.
    """
    call = guest(client, crystal)
    response = call(
        "/api/guest/order",
        "post",
        {
            "lines": [{"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1}],
            "timing": "asap",
        },
        HTTP_IDEMPOTENCY_KEY="r5-flat",
    )
    assert response.status_code == 201, response.content

    with tenant_context(crystal):
        order = Order.objects.get(pk=response.json()["id"])
        assert not order.children.exists()
        assert order.execution_point.code == "kitchen"


def test_guest_sees_one_order_not_two(client, crystal, aggregator):
    """Гостю разъезд не виден: он заказал один раз — видит один заказ."""
    call = guest(client, crystal)
    call(
        "/api/guest/order",
        "post",
        {
            "service_code": "room_service",
            "lines": [
                {"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1},
                {"item_id": aggregator["cocktail"], "quantity": 1},
            ],
            "timing": "asap",
        },
        HTTP_IDEMPOTENCY_KEY="r5-one-order",
    )

    listing = call("/api/guest/orders").json()
    assert len(listing["active"]) == 1
    # И в нём — позиции обоих исполнителей.
    assert len(listing["active"][0]["items"]) == 2


# --- Коммерция считается по заведению корзины ------------------------------


def test_quote_uses_the_commerce_of_the_cart_service(client, crystal, aggregator):
    """
    Сбор берётся у заведения, в котором гость собрал корзину, а не у отеля и не
    у источника заимствованной позиции.
    """
    with tenant_context(crystal):
        Service.objects.filter(code="room_service").update(service_fee_bp=1000)

    call = guest(client, crystal)
    body = {
        "service_code": "room_service",
        "lines": [{"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1}],
    }
    quote = call("/api/guest/cart/quote", "post", body).json()

    assert quote["service_fee_minor"] > 0, "сбор заведения обязан попасть в quote"
    # И снимок заказа сходится с предпросчётом — иначе гость увидел бы одну
    # сумму, а заплатил другую.
    placed = call(
        "/api/guest/order", "post", {**body, "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="r5-quote-parity",
    ).json()
    assert placed["total"] == quote["total_minor"]


def test_unknown_service_code_does_not_silently_flatten(client, crystal, aggregator):
    """
    Опечатка в коде заведения не должна тихо превращаться в плоский заказ по
    старому пути: это выглядело бы как «работает», а коммерция была бы чужой.
    """
    call = guest(client, crystal)
    response = call(
        "/api/guest/order",
        "post",
        {
            "service_code": "no-such-venue",
            "lines": [{"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1}],
            "timing": "asap",
        },
        HTTP_IDEMPOTENCY_KEY="r5-unknown-service",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "unknown_service"
