"""
Карточка блюда показывает КБЖУ и состав — значит гостевой ответ
должен их нести. Данные лежат в attributes позиции, сериализатор их разворачивает.
"""

from __future__ import annotations

import pytest

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _menu_items(client, crystal, guest_token):
    response = client.get(
        "/api/guest/menu",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    return [item for category in body["categories"] for item in category["items"]]


def test_guest_item_carries_nutrition(client, crystal, guest_token):
    items = _menu_items(client, crystal, guest_token)
    # У товарной позиции есть КБЖУ и состав (сид наполняет product-позиции).
    nourished = [i for i in items if i.get("nutrition")]
    assert nourished, "ни одна позиция не несёт nutrition"
    sample = nourished[0]["nutrition"]
    assert sample["calories"] is not None
    for key in ("protein", "fat", "carbs", "composition"):
        assert key in sample


def test_nutrition_key_is_always_present(client, crystal, guest_token):
    """Ключ nutrition стабилен: объект или null — карточка сама решает, рисовать ли секцию."""
    items = _menu_items(client, crystal, guest_token)
    assert all("nutrition" in item for item in items)
