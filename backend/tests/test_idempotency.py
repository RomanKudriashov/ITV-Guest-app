"""
Идемпотентность создания заказа.

Сценарий из жизни: гость в лифте, сеть отвалилась, приложение повторило
запрос. Двух стейков быть не должно.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.orders.models import Order

from .conftest import host_for
from .helpers import order_payload

pytestmark = pytest.mark.django_db


def _post_order(client, hotel, token, payload, key):
    return client.post(
        "/api/guest/order",
        data=payload,
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_repeated_request_with_same_key_creates_one_order(client, crystal, guest_token):
    payload = order_payload(crystal)

    first = _post_order(client, crystal, guest_token, payload, "key-1")
    assert first.status_code == 201, first.content

    second = _post_order(client, crystal, guest_token, payload, "key-1")
    assert second.status_code == 200, second.content

    assert first.json()["id"] == second.json()["id"]
    assert first.json()["number"] == second.json()["number"]

    with tenant_context(crystal):
        assert Order.objects.count() == 1


def test_same_key_with_different_body_is_a_conflict(client, crystal, guest_token):
    payload = order_payload(crystal)
    assert _post_order(client, crystal, guest_token, payload, "key-2").status_code == 201

    changed = {**payload, "comment": "и побыстрее"}
    conflict = _post_order(client, crystal, guest_token, changed, "key-2")

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_conflict"

    with tenant_context(crystal):
        assert Order.objects.count() == 1


def test_different_keys_create_different_orders(client, crystal, guest_token):
    payload = order_payload(crystal)
    first = _post_order(client, crystal, guest_token, payload, "key-3")
    second = _post_order(client, crystal, guest_token, payload, "key-4")

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    with tenant_context(crystal):
        assert Order.objects.count() == 2


def test_order_requires_idempotency_key(client, crystal, guest_token):
    response = client.post(
        "/api/guest/order",
        data=order_payload(crystal),
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 400
    assert response.json()["code"] == "idempotency_key_required"
