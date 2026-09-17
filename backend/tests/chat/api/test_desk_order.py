"""
Заказ от имени гостя с рабочего места ресепшена.

Тот же каталог, те же места и та же коммерция, что у гостя; отличается
только, кто оформил — и гость это видит.
"""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.accounts.models import GuestSession
from apps.chat.models import ChatThread
from apps.core.context import tenant_context
from apps.hotels.models import Location
from apps.orders.models import Order, OrderStatusChange
from tests.chat.api.test_chat_reviews import guest_for, staff_call

pytestmark = pytest.mark.django_db


def _item(desk, point, code):
    menu = desk(f"/api/tracker/desk/catalog?point={point}&type=product").json()
    return next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == code)


def _place_id(crystal, code):
    with tenant_context(crystal):
        return str(Location.objects.get(code=code).pk)


@pytest.fixture
def dialog(client, crystal):
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "принесите салат"}).json()["thread_id"]
    return guest, thread_id


def _order(client, crystal, thread_id, body, key, login="reception"):
    from tests.conftest import host_for

    token = client.post(
        "/api/staff/auth/login",
        data={"email": f"{login}@{crystal.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["access"]
    return client.post(
        f"/api/tracker/desk/threads/{thread_id}/order",
        data={"timing": "asap", **body},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_the_guest_sees_the_order_marked_as_placed_by_the_reception(client, crystal, dialog):
    guest, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    caesar = _item(desk, "kitchen", "caesar")

    response = _order(
        client, crystal, thread_id,
        {"service_code": "kitchen", "lines": [{"item_id": caesar, "quantity": 2}],
         "location_id": _place_id(crystal, "in_room")},
        key="desk-live",
    )
    assert response.status_code == 201, response.content
    placed = response.json()
    assert placed["placed_by_staff"] is True and placed["placed_by_label"] == "Ресепшен"
    assert placed["room"] == "212"

    mine = guest.get("/api/guest/orders").json()
    listed = next(o for o in mine["active"] if o["number"] == placed["number"])
    assert listed["placed_by_staff"] is True, "у гостя пометка «оформил ресепшен»"
    active = guest.get("/api/guest/orders/active").json()["orders"]
    assert next(o for o in active if o["number"] == placed["number"])["placed_by_staff"] is True

    chat = guest.get("/api/guest/chat").json()
    note = next(m for m in chat["messages"] if f"№{placed['number']}" in m["body"])
    assert note["author_name"] == "Ресепшен", "гость видит отдел, а не имя"

    with tenant_context(crystal):
        order = Order.objects.get(pk=placed["id"])
        assert order.placed_by.email == "reception@crystal.local"
        assert order.guest_session_id is not None
        created = OrderStatusChange.objects.filter(order=order).order_by("created_at").first()
        assert created.actor_type == "staff" and created.actor_id == order.placed_by_id

    card = staff_call(client, crystal, "chef")(f"/api/tracker/order/{placed['id']}").json()
    assert card["placed_by"]["name"], "в трекере видно, кто оформил"


def test_a_guests_own_order_is_not_marked(client, crystal, dialog):
    guest, _ = dialog
    menu = guest.get("/api/guest/catalog?type=product").json()
    caesar = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    own = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": caesar, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="own",
    ).json()
    assert own["placed_by_staff"] is False and own["placed_by_label"] is None


def test_a_guest_who_left_gets_the_order_on_the_room_only(client, crystal, dialog):
    guest, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    caesar = _item(desk, "kitchen", "caesar")
    with tenant_context(crystal):
        session_id = ChatThread.objects.get(pk=thread_id).guest_session_id
        GuestSession.objects.filter(pk=session_id).update(revoked_at=timezone.now())

    response = _order(
        client, crystal, thread_id,
        {"service_code": "kitchen", "lines": [{"item_id": caesar, "quantity": 1}]},
        key="desk-gone",
    )
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        order = Order.objects.get(pk=response.json()["id"])
        assert order.guest_session_id is None and order.room.number == "212"
        assert not ChatThread.objects.get(pk=thread_id).messages.filter(body__contains="Оформили").exists(), (
            "уехавшему в чат не пишем"
        )


def test_nowhere_to_deliver_is_refused(client, crystal):
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "?"}).json()["thread_id"]
    desk = staff_call(client, crystal, "reception")
    caesar = _item(desk, "kitchen", "caesar")
    with tenant_context(crystal):
        thread = ChatThread.objects.get(pk=thread_id)
        GuestSession.objects.filter(pk=thread.guest_session_id).update(revoked_at=timezone.now())
        ChatThread.objects.filter(pk=thread_id).update(room=None)
    response = _order(
        client, crystal, thread_id,
        {"service_code": "kitchen", "lines": [{"item_id": caesar, "quantity": 1}]},
        key="desk-nowhere",
    )
    assert response.status_code == 422 and response.json()["code"] == "no_guest_target"


def test_the_matrix_and_pickup_work_as_for_the_guest(client, crystal, dialog):
    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    negroni = _item(desk, "bar", "negroni")
    caesar = _item(desk, "kitchen", "caesar")

    places = desk(f"/api/tracker/desk/threads/{thread_id}/locations?items={negroni}").json()["locations"]
    codes = {p["code"]: p["delivery_mode"] for p in places}
    assert codes.get("bar-counter") == "pickup" and "in_room" in codes

    picked = _order(
        client, crystal, thread_id,
        {"service_code": "bar", "lines": [{"item_id": negroni, "quantity": 1}],
         "location_id": _place_id(crystal, "bar-counter")},
        key="desk-pickup",
    )
    assert picked.status_code == 201, picked.content
    assert picked.json()["delivery_mode"] == "pickup"

    refused = _order(
        client, crystal, thread_id,
        {"service_code": "kitchen", "lines": [{"item_id": caesar, "quantity": 1}],
         "location_id": _place_id(crystal, "bar-counter")},
        key="desk-refused",
    )
    assert refused.status_code == 422 and refused.json()["code"] == "location_not_available"

    quote = desk(
        f"/api/tracker/desk/threads/{thread_id}/quote", "post",
        {"service_code": "bar", "lines": [{"item_id": negroni, "quantity": 2}],
         "location_id": _place_id(crystal, "bar-counter")},
    ).json()
    assert quote["total_minor"] > 0 and quote["delivery_fee_minor"] == 0


def test_a_repeat_with_the_same_key_is_the_same_order(client, crystal, dialog):
    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    caesar = _item(desk, "kitchen", "caesar")
    body = {"service_code": "kitchen", "lines": [{"item_id": caesar, "quantity": 1}]}
    first = _order(client, crystal, thread_id, body, key="desk-same")
    again = _order(client, crystal, thread_id, body, key="desk-same")
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"]


def test_venues_are_the_guests_and_the_reception_is_not_one(client, crystal):
    venues = staff_call(client, crystal, "reception")("/api/tracker/desk/venues").json()["venues"]
    codes = {v["code"] for v in venues}
    assert {"kitchen", "bar"} <= codes and "reception" not in codes


def test_only_the_desk_orders(client, crystal, dialog):
    _, thread_id = dialog
    cook = staff_call(client, crystal, "chef")
    for path, method in (
        ("/api/tracker/desk/venues", "get"),
        ("/api/tracker/desk/catalog?point=kitchen", "get"),
        (f"/api/tracker/desk/threads/{thread_id}/locations", "get"),
        (f"/api/tracker/desk/threads/{thread_id}/quote", "post"),
    ):
        response = cook(path, method, {"lines": []}) if method == "post" else cook(path)
        assert response.status_code == 403, (path, response.content)
    refused = _order(client, crystal, thread_id, {"service_code": "kitchen", "lines": []}, key="cook", login="chef")
    assert refused.status_code == 403
