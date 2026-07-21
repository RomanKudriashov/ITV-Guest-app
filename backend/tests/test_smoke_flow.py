"""
Дымовой сценарий: сессия → меню → заказ → статус.

Это тест фундамента, а не фич: он проходит через резолюцию тенанта,
контекст языка, расписание, снапшоты цен, резолв маршрута, идемпотентность,
событийную шину и аудит.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.events import bus
from apps.orders.models import Order, OrderStatusChange
from apps.orders.services import change_status

from .conftest import host_for
from .helpers import order_payload

pytestmark = pytest.mark.django_db


def test_full_guest_flow(client, crystal, guest_token, django_capture_on_commit_callbacks):
    host = host_for(crystal)
    auth = f"Bearer {guest_token}"

    # --- Меню --------------------------------------------------------
    menu = client.get("/api/guest/menu", HTTP_HOST=host, HTTP_AUTHORIZATION=auth)
    assert menu.status_code == 200
    body = menu.json()
    codes = {category["code"] for category in body["categories"]}
    assert {"hot", "salads", "drinks"} <= codes

    steak = next(
        item
        for category in body["categories"]
        for item in category["items"]
        if item["code"] == "ribeye"
    )
    assert steak["price"] == 190000, "цены — в копейках, целыми"
    # В списке меню модификаторов нет — только признак, что они есть: витрине
    # этого хватает, чтобы решить, открывать карточку или добавлять в один тап.
    assert steak["has_required_modifiers"] is True
    assert "modifier_groups" not in steak

    detail = client.get(
        f"/api/guest/item/{steak['id']}", HTTP_HOST=host, HTTP_AUTHORIZATION=auth
    )
    assert detail.status_code == 200
    doneness = next(g for g in detail.json()["modifier_groups"] if g["code"] == "doneness")
    assert doneness["is_required"] is True
    assert len(doneness["options"]) == 4

    # --- Заказ -------------------------------------------------------
    payload = order_payload(crystal, item_code="ribeye")
    # События шины эмитятся после коммита. В TestCase транзакция не
    # коммитится — прогоняем колбэки явно, иначе подписчики не отработают.
    with django_capture_on_commit_callbacks(execute=True):
        created = client.post(
            "/api/guest/order",
            data=payload,
            content_type="application/json",
            HTTP_HOST=host,
            HTTP_AUTHORIZATION=auth,
            HTTP_IDEMPOTENCY_KEY="smoke-1",
        )
    assert created.status_code == 201, created.content
    order_body = created.json()
    assert order_body["status"]["code"] == "new"
    assert order_body["number"] == 1
    assert order_body["items"][0]["title"] == "Стейк рибай", "локализация по языку отеля"
    assert order_body["total"] == order_body["items"][0]["line_total"]

    # --- Статус ------------------------------------------------------
    status = client.get(
        f"/api/guest/order/{order_body['id']}", HTTP_HOST=host, HTTP_AUTHORIZATION=auth
    )
    assert status.status_code == 200
    assert status.json()["status"]["code"] == "new"

    # --- Побочные эффекты, ради которых всё и строилось ---------------
    with tenant_context(crystal):
        order = Order.objects.select_related("execution_point").get(pk=order_body["id"])
        assert order.execution_point.code == "kitchen", "маршрут резолвится при создании"
        assert order.items.first().unit_price_snapshot == 190000
        assert OrderStatusChange.objects.filter(order=order).count() == 1
        assert AuditLog.objects.filter(action=bus.ORDER_CREATED).exists()


def test_language_negotiation(client, crystal, guest_token):
    """Язык берётся из Accept-Language, фолбэк — язык отеля."""
    host = host_for(crystal)
    auth = f"Bearer {guest_token}"

    english = client.get(
        "/api/guest/menu",
        HTTP_HOST=host,
        HTTP_AUTHORIZATION=auth,
        HTTP_ACCEPT_LANGUAGE="en-GB,en;q=0.9",
    ).json()
    titles = {c["code"]: c["title"] for c in english["categories"]}
    assert titles["hot"] == "Hot dishes"

    russian = client.get(
        "/api/guest/menu",
        HTTP_HOST=host,
        HTTP_AUTHORIZATION=auth,
        HTTP_ACCEPT_LANGUAGE="ru-RU,ru;q=0.9",
    ).json()
    titles = {c["code"]: c["title"] for c in russian["categories"]}
    assert titles["hot"] == "Горячее"


def test_status_change_emits_event_and_history(
    client, crystal, guest_token, django_capture_on_commit_callbacks
):
    payload = order_payload(crystal)
    created = client.post(
        "/api/guest/order",
        data=payload,
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
        HTTP_IDEMPOTENCY_KEY="smoke-2",
    )
    order_id = created.json()["id"]

    with tenant_context(crystal):
        with django_capture_on_commit_callbacks(execute=True):
            order = Order.objects.get(pk=order_id)
            change_status(order, to_code="accepted", actor_type="staff")
            change_status(
                Order.objects.get(pk=order_id), to_code="preparing", actor_type="staff"
            )

        history = list(
            OrderStatusChange.objects.filter(order_id=order_id).values_list(
                "to_status__code", flat=True
            )
        )
        assert history == ["new", "accepted", "preparing"]
        assert AuditLog.objects.filter(action=bus.ORDER_STATUS_CHANGED).count() == 2


def test_required_modifier_is_enforced(client, crystal, guest_token):
    """Стейк без прожарки на кухню не уходит — проверяет сервер, не фронт."""
    payload = order_payload(crystal, item_code="ribeye")
    payload["lines"][0]["modifier_option_ids"] = []

    response = client.post(
        "/api/guest/order",
        data=payload,
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
        HTTP_IDEMPOTENCY_KEY="smoke-3",
    )
    assert response.status_code == 422
    assert response.json()["code"] == "modifier_required"


def test_health_endpoint_reports_dependencies(client):
    response = client.get("/api/health", HTTP_HOST="api.guest.localhost")
    assert response.status_code == 200
    body = response.json()
    assert "database" in body["checks"]
    assert body["checks"]["database"]["ok"] is True
    assert bus.ORDER_CREATED in body["event_subscribers"]
