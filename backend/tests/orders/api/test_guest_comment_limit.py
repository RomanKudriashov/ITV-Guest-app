"""
ПРЕДЕЛ КОММЕНТАРИЯ ГОСТЯ — 300 СИМВОЛОВ И ТАМ, И ТАМ (партия 31, DEV-10 QA).

Витрина пускала 300, сервер молча отрезал комментарий позиции до 255, а
комментарий заказа не ограничивал вовсе. Теперь предел один: больше 300 —
отказ схемы, ровно 300 доходят целиком; символ считается символом (эмодзи —
один), как на витрине.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.orders.models import Order
from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _order(client, hotel, *, comment="", line_comment="", key="c-1"):
    token = client.post(
        "/api/guest/session", data={"room_number": "305"}, content_type="application/json", HTTP_HOST=host_for(hotel)
    ).json()["token"]
    menu = client.get(
        "/api/guest/catalog?type=product", HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()
    item_id = next(e["id"] for c in menu["categories"] for e in c["items"] if e["code"] == "caesar")
    return client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1, "comment": line_comment}], "comment": comment},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_longer_than_300_is_refused_for_order_and_line(client, crystal):
    assert _order(client, crystal, comment="я" * 301, key="c-a").status_code == 422
    assert _order(client, crystal, line_comment="я" * 301, key="c-b").status_code == 422


def test_exactly_300_reaches_the_order_whole(client, crystal):
    """300 знаков позиции раньше молча становились 255."""
    text = "😀" * 300  # эмодзи — один символ, как считает витрина
    response = _order(client, crystal, comment=text, line_comment="ж" * 300, key="c-c")
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        order = Order.objects.get(pk=response.json()["id"])
        assert order.comment == text
        assert order.items.first().comment == "ж" * 300
