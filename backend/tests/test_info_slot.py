"""
Типы info и slot: страница-чтение и бронь слота.

Архитектурная проверка: оба типа проходят тем же гостевым потоком, что еда и
заявки. Ключевой тест — предотвращение двойной брони под конкурентностью.
"""

from __future__ import annotations

import threading
from datetime import date, datetime, timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item, SlotBooking, SlotConfig
from apps.core.context import tenant_context
from apps.orders.models import Order

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


class Guest:
    def __init__(self, client, hotel, token):
        self.client, self.hotel, self.token = client, hotel, token

    def get(self, path, **extra):
        return self.client.get(
            path, HTTP_HOST=host_for(self.hotel), HTTP_AUTHORIZATION=f"Bearer {self.token}", **extra
        )

    def post(self, path, data=None, **extra):
        return self.client.post(
            path,
            data=data or {},
            content_type="application/json",
            HTTP_HOST=host_for(self.hotel),
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            **extra,
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


def next_working_date() -> str:
    """Ближайшая дата — просто завтра; SPA открыт все дни недели."""
    return (timezone.localdate() + timedelta(days=1)).isoformat()


# ===========================================================================
# info
# ===========================================================================


def test_info_page_is_localized_and_not_orderable(guest):
    catalog = guest.get("/api/guest/catalog?type=info").json()
    wifi = next(
        entry for cat in catalog["categories"] for entry in cat["items"] if entry["code"] == "wifi"
    )
    assert wifi["is_orderable"] is False
    assert "Crystal-Guest" in wifi["content"]

    english = guest.get("/api/guest/catalog?type=info", HTTP_ACCEPT_LANGUAGE="en").json()
    wifi_en = next(
        e for c in english["categories"] for e in c["items"] if e["code"] == "wifi"
    )
    assert "Password" in wifi_en["content"]


def test_info_item_detail_carries_content(guest):
    catalog = guest.get("/api/guest/catalog?type=info").json()
    about_id = next(
        e["id"] for c in catalog["categories"] for e in c["items"] if e["code"] == "about"
    )
    detail = guest.get(f"/api/guest/item/{about_id}").json()
    assert detail["type"] == "info"
    assert detail["is_orderable"] is False
    assert detail["content"]


def test_info_cannot_be_ordered(guest):
    catalog = guest.get("/api/guest/catalog?type=info").json()
    wifi_id = next(
        e["id"] for c in catalog["categories"] for e in c["items"] if e["code"] == "wifi"
    )
    response = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": wifi_id, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="info-order",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "not_orderable"


# ===========================================================================
# slot — доступность
# ===========================================================================


def massage(guest) -> dict:
    catalog = guest.get("/api/guest/catalog?type=slot").json()
    return next(
        e for c in catalog["categories"] for e in c["items"] if e["code"] == "massage"
    )


def test_slots_are_generated_from_working_hours(guest):
    item = massage(guest)
    body = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()

    assert body["duration_minutes"] == 60
    assert body["capacity"] == 2
    # SPA 10:00–20:00 по часу — десять слотов.
    assert len(body["slots"]) == 10
    assert body["slots"][0]["starts_at"][11:16] == "10:00"
    assert all(s["capacity_left"] == 2 for s in body["slots"])


def test_booked_slot_shows_less_capacity(guest, crystal):
    item = massage(guest)
    slots = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    target = slots["slots"][0]["starts_at"]

    guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": target},
        HTTP_IDEMPOTENCY_KEY="slot-cap-1",
    )

    after = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    first = next(s for s in after["slots"] if s["starts_at"] == target)
    assert first["capacity_left"] == 1
    assert first["available"] is True  # вместимость 2, ещё есть место


# ===========================================================================
# slot — бронь
# ===========================================================================


def test_booking_creates_an_order_routed_to_the_department(guest, crystal):
    item = massage(guest)
    slots = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    target = slots["slots"][0]["starts_at"]

    response = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": target},
        HTTP_IDEMPOTENCY_KEY="slot-book-1",
    )
    assert response.status_code == 201, response.content
    body = response.json()

    assert body["type"] == "booking"
    assert body["slot"]["resource_title"] == "Массаж 60 минут"
    assert body["slot"]["starts_at"] == target

    with tenant_context(crystal):
        order = Order.objects.select_related("execution_point").get(pk=body["id"])
        assert order.execution_point.code == "spa"
        assert SlotBooking.objects.filter(order=order, is_active=True).count() == 1


def test_slot_start_is_required_for_slot_type(guest):
    item = massage(guest)
    response = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}]},
        HTTP_IDEMPOTENCY_KEY="slot-noslot",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "slot_required"


def test_time_outside_the_grid_is_refused(guest):
    item = massage(guest)
    # 10:30 не попадает в часовую сетку 10:00, 11:00…
    bad = f"{next_working_date()}T10:30:00+03:00"
    response = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": bad},
        HTTP_IDEMPOTENCY_KEY="slot-offgrid",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "slot_not_offered"


def test_past_slot_is_refused(guest):
    item = massage(guest)
    past = f"{(timezone.localdate() - timedelta(days=1)).isoformat()}T10:00:00+03:00"
    response = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": past},
        HTTP_IDEMPOTENCY_KEY="slot-past",
    )
    assert response.status_code == 422
    assert response.json()["code"] in {"slot_in_past", "slot_not_offered"}


# ===========================================================================
# slot — ДВОЙНАЯ БРОНЬ ПОД КОНКУРЕНТНОСТЬЮ (ядро прогона)
# ===========================================================================


@pytest.mark.django_db(transaction=True)
def test_capacity_is_not_oversold_under_concurrency(client, crystal):
    """
    Вместимость 1 и два гостя, хватающие слот одновременно: только один
    успевает, второй получает slot_taken. Проверяем именно гонку — два потока,
    реальные транзакции, без искусственной сериализации на стороне теста.
    """
    from django.core.management import call_command

    call_command("seed_demo_hotel", verbosity=0)

    with tenant_context(crystal):
        item = Item.objects.get(code="massage")
        # Ставим вместимость 1 — теперь слот на одного.
        SlotConfig.objects.filter(item=item).update(capacity=1)
        item_id = str(item.pk)

    # Два гостя.
    tokens = []
    for room in ("305", "201"):
        tokens.append(
            client.post(
                "/api/guest/session",
                data={"room_number": room},
                content_type="application/json",
                HTTP_HOST=host_for(crystal),
            ).json()["token"]
        )

    target = f"{next_working_date()}T12:00:00+03:00"
    results: list[int] = []
    barrier = threading.Barrier(2)

    def book(token, key):
        # Свежий клиент на поток: Django test client не потокобезопасен.
        from django.test import Client

        local = Client()
        barrier.wait()  # стартуем максимально одновременно
        response = local.post(
            "/api/guest/order",
            data={"lines": [{"item_id": item_id}], "slot_start": target},
            content_type="application/json",
            HTTP_HOST=host_for(crystal),
            HTTP_AUTHORIZATION=f"Bearer {token}",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        results.append(response.status_code)

    threads = [
        threading.Thread(target=book, args=(tokens[0], "race-a")),
        threading.Thread(target=book, args=(tokens[1], "race-b")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    # Ровно одна бронь прошла, вторая отклонена как «занято».
    assert sorted(results) == [201, 409], f"ожидали [201, 409], получили {sorted(results)}"

    with tenant_context(crystal):
        active = SlotBooking.objects.filter(
            item_id=item_id, starts_at__isnull=False, is_active=True
        ).count()
        assert active == 1, "вместимость превышена — двойная бронь"


# ===========================================================================
# slot — отмена освобождает слот
# ===========================================================================


def test_cancel_frees_the_slot(guest, crystal, django_capture_on_commit_callbacks):
    item = massage(guest)
    slots = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    target = slots["slots"][0]["starts_at"]

    order_id = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": target},
        HTTP_IDEMPOTENCY_KEY="slot-cancel-1",
    ).json()["id"]

    # Заняли — вместимость упала.
    mid = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    assert next(s for s in mid["slots"] if s["starts_at"] == target)["capacity_left"] == 1

    with django_capture_on_commit_callbacks(execute=True):
        cancelled = guest.post(f"/api/guest/order/{order_id}/cancel", {"reason": "передумал"})
    assert cancelled.status_code == 200

    # Отмена вернула место.
    after = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    assert next(s for s in after["slots"] if s["starts_at"] == target)["capacity_left"] == 2

    with tenant_context(crystal):
        assert not SlotBooking.objects.filter(order_id=order_id, is_active=True).exists()


def test_staff_cancel_also_frees_the_slot(guest, crystal, cms, django_capture_on_commit_callbacks):
    """Отмена персоналом освобождает слот так же — код отмены общий."""
    item = massage(guest)
    slots = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    target = slots["slots"][1]["starts_at"]

    order_id = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": target},
        HTTP_IDEMPOTENCY_KEY="slot-staffcancel",
    ).json()["id"]

    spa = _spa_tracker(cms.client, crystal)
    with django_capture_on_commit_callbacks(execute=True):
        spa(f"/api/tracker/order/{order_id}/cancel", {"reason": "мастер заболел"})

    after = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    assert next(s for s in after["slots"] if s["starts_at"] == target)["capacity_left"] == 2


def _spa_tracker(client, hotel):
    token = client.post(
        "/api/staff/auth/login",
        data={"email": f"spa@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["access"]

    def call(path, data):
        return client.post(
            path,
            data=data,
            content_type="application/json",
            HTTP_HOST=host_for(hotel),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    return call


# ===========================================================================
# Трекер и CMS
# ===========================================================================


def test_tracker_card_shows_the_slot(guest, crystal, cms):
    item = massage(guest)
    slots = guest.get(f"/api/guest/slots?item_id={item['id']}&date={next_working_date()}").json()
    target = slots["slots"][0]["starts_at"]
    guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item["id"]}], "slot_start": target},
        HTTP_IDEMPOTENCY_KEY="slot-track",
    )

    spa = _spa_tracker(cms.client, crystal)
    board = cms.client.get(
        "/api/tracker/orders?point=spa",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {_spa_token(cms.client, crystal)}",
    ).json()
    card = board["columns"][0]["orders"][0]
    assert card["type"] == "booking"
    assert card["slot"]["resource_title"] == "Массаж 60 минут"


def _spa_token(client, hotel):
    return client.post(
        "/api/staff/auth/login",
        data={"email": f"spa@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["access"]


def test_cms_edits_info_content(cms, crystal):
    with tenant_context(crystal):
        wifi_id = str(Item.objects.get(code="wifi").pk)

    response = cms.patch(
        f"/api/cms/items/{wifi_id}", {"content": {"ru": "Новый пароль: qwerty"}}
    )
    assert response.status_code == 200
    assert response.json()["content"]["ru"] == "Новый пароль: qwerty"


def test_cms_slot_config_roundtrip(cms, crystal):
    with tenant_context(crystal):
        item_id = str(Item.objects.get(code="massage").pk)
        from apps.hotels.models import ExecutionPoint, Schedule

        schedule_id = str(Schedule.objects.get(name="SPA 10:00–20:00").pk)
        point_id = str(ExecutionPoint.objects.get(code="spa").pk)

    saved = cms.put(
        f"/api/cms/items/{item_id}/slot-config",
        {
            "duration_minutes": 90,
            "capacity": 3,
            "schedule_id": schedule_id,
            "execution_point_id": point_id,
        },
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["duration_minutes"] == 90
    assert saved.json()["capacity"] == 3


def test_slot_config_rejected_for_non_slot_item(cms, crystal):
    with tenant_context(crystal):
        caesar_id = str(Item.objects.get(code="caesar").pk)
        from apps.hotels.models import ExecutionPoint, Schedule

        schedule_id = str(Schedule.objects.first().pk)
        point_id = str(ExecutionPoint.objects.get(code="kitchen").pk)

    response = cms.put(
        f"/api/cms/items/{caesar_id}/slot-config",
        {"duration_minutes": 60, "capacity": 1, "schedule_id": schedule_id, "execution_point_id": point_id},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "slots_not_supported"


# ===========================================================================
# Изоляция
# ===========================================================================


def test_slots_are_isolated_between_hotels(guest, cms_aurora):
    """Позицию брони одного отеля нельзя запросить из другого."""
    aurora_massage = None
    catalog = cms_aurora.get("/api/cms/items?type=slot").json()
    if catalog:
        aurora_massage = catalog[0]["id"]

    if aurora_massage:
        response = guest.get(
            f"/api/guest/slots?item_id={aurora_massage}&date={next_working_date()}"
        )
        assert response.status_code == 404
