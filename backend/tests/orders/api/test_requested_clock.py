"""
ВРЕМЯ БЕЗ ДАТЫ — БЛИЖАЙШЕЕ БУДУЩЕЕ В ПОЯСЕ ОТЕЛЯ (партия 30, п.46).

Корзина считала «12:00» в поясе телефона гостя и слала готовый момент: гость с
телефоном на дубайском времени в московском отеле заказывал на час раньше.
Теперь время уходит как есть (`requested_clock`), а дату решает сервер по
часам отеля — тем же правилом, что поле «время заказа» у заявок.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.orders.models import Order
from tests.conftest import host_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def late_evening(monkeypatch, crystal):
    """«Сейчас» — 23:00 по отелю, сегодня."""
    day = crystal.local_now().date()
    fake = datetime.combine(day, time(23, 0), tzinfo=crystal.tzinfo)
    monkeypatch.setattr(timezone, "now", lambda: fake)
    return day


def _order(client, crystal, clock: str, key: str):
    token = client.post(
        "/api/guest/session", data={"room_number": "305"}, content_type="application/json", HTTP_HOST=host_for(crystal)
    ).json()["token"]
    auth = {"HTTP_HOST": host_for(crystal), "HTTP_AUTHORIZATION": f"Bearer {token}"}
    menu = client.get("/api/guest/catalog?type=product", **auth).json()
    item = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    return client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item, "quantity": 1}], "timing": "scheduled", "requested_clock": clock},
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY=key,
        **auth,
    )


def _local(crystal, order_id):
    with tenant_context(crystal):
        return crystal.to_local(Order.objects.get(pk=order_id).requested_time)


def test_a_clock_already_past_today_means_tomorrow_in_the_hotel(client, crystal, late_evening):
    """В 23:00 по отелю «08:00» — это завтра 08:00 по отелю."""
    response = _order(client, crystal, "08:00", "clock-tomorrow")
    assert response.status_code == 201, response.content
    assert _local(crystal, response.json()["id"]) == datetime.combine(
        late_evening + timedelta(days=1), time(8, 0), tzinfo=crystal.tzinfo
    )


def test_a_clock_later_today_stays_today(client, crystal, late_evening):
    response = _order(client, crystal, "23:30", "clock-today")
    assert response.status_code == 201, response.content
    assert _local(crystal, response.json()["id"]) == datetime.combine(late_evening, time(23, 30), tzinfo=crystal.tzinfo)


def test_a_bad_clock_is_refused(client, crystal):
    response = _order(client, crystal, "25:70", "clock-bad")
    assert response.status_code == 422 and response.json()["code"] == "requested_time_invalid"
