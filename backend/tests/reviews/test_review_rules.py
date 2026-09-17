"""
Правила отзыва волны 8: сбор выключен — отзыва нет и мимо витрины; низкая —
две звезды и ниже; отзыв на заказ из двух заведений — один, а разбирают его
руководители каждой части.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.events import bus
from apps.hotels.models import ExecutionPoint, Hotel
from apps.notifications.models import EventRecord
from apps.orders.models import Order
from apps.reviews.models import Review
from tests.chat.api.test_chat_reviews import _finished_order, guest_for
from tests.orders.api.test_guest_service_cart import aggregator, dish_id  # noqa: F401
from tests.orders.api.test_guest_service_cart import guest as cart_guest

pytestmark = pytest.mark.django_db


@pytest.fixture
def guest(client, crystal):
    return guest_for(client, crystal, room="212")


def _low_events(send):
    captured = []
    handler = bus.subscribe(bus.REVIEW_LOW)(lambda event: captured.append(event))
    try:
        send()
    finally:
        bus._subscribers[bus.REVIEW_LOW].remove(handler)
    return captured


def test_a_direct_request_is_refused_when_the_hotel_collects_no_reviews(client, crystal, guest, cms):
    order_id = _finished_order(client, crystal, guest, key="rules-off")
    cms.patch("/api/cms/review-settings", {"enabled": False})

    response = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 5})
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "reviews_disabled"
    with tenant_context(crystal):
        assert not Review.all_objects.filter(order_id=order_id).exists()


def test_low_is_two_stars_and_below_by_default(client, crystal, guest, django_capture_on_commit_callbacks):
    assert Hotel._meta.get_field("review_low_threshold").default == 2
    three = _finished_order(client, crystal, guest, key="rules-3")
    two = _finished_order(client, crystal, guest, key="rules-2")

    def send(order_id, rating):
        with django_capture_on_commit_callbacks(execute=True):
            guest.post(f"/api/guest/order/{order_id}/review", {"rating": rating})

    assert _low_events(lambda: send(three, 3)) == [], "тройка больше не низкая"
    assert len(_low_events(lambda: send(two, 2))) == 1


def test_a_two_venue_order_alerts_the_manager_of_each_part(
    client, crystal, aggregator, settings, django_capture_on_commit_callbacks  # noqa: F811
):
    settings.NOTIFICATIONS_ENABLED = True
    call = cart_guest(client, crystal)
    placed = call(
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
        HTTP_IDEMPOTENCY_KEY="rules-parts",
    )
    assert placed.status_code == 201, placed.content
    order_id = placed.json()["id"]
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        for child in Order.objects.get(pk=order_id).children.all():
            change_status(get_order(child.pk), to_code="done", actor_type="staff")
        assert Order.objects.get(pk=order_id).status.is_terminal

    with django_capture_on_commit_callbacks(execute=True):
        response = call(f"/api/guest/order/{order_id}/review", "post", {"rating": 1, "comment": "остыло"})
    assert response.status_code == 201, response.content

    with tenant_context(crystal):
        points = set(
            EventRecord.objects.filter(code="review.low").values_list("execution_point__code", flat=True)
        )
        assert points == {"kitchen", "bar"}, "по записи на каждую часть, агрегату — нет"
        assert ExecutionPoint.objects.filter(code="room_service").exists()


# --- Одна карточка «оцените» на стартовой ------------------------------------


def test_the_home_asks_to_rate_only_the_last_closed_order(client, crystal, guest):
    assert guest.get("/api/guest/orders/active").json()["to_review"] is None

    older = _finished_order(client, crystal, guest, key="home-older")
    newer = _finished_order(client, crystal, guest, key="home-newer")
    to_review = guest.get("/api/guest/orders/active").json()["to_review"]
    assert to_review["id"] == newer, "одна карточка — о последнем закрытом"
    assert to_review["summary"]

    guest.post(f"/api/guest/order/{newer}/review", {"rating": 5})
    assert guest.get("/api/guest/orders/active").json()["to_review"] is None, (
        "оценённый уходит, а старый неоценённый следом не всплывает"
    )
    assert older != newer


def test_a_live_order_is_never_offered_for_rating(client, crystal, guest):
    menu = guest.get("/api/guest/catalog?type=product").json()
    item_id = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="home-live",
    )
    body = guest.get("/api/guest/orders/active").json()
    assert body["orders"], "заказ живой"
    assert body["to_review"] is None, "оценка живого заказа — оценка ожидания"
