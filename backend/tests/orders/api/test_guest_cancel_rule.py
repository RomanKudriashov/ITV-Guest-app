"""
ОТМЕНА ГОСТЕМ — ТОЛЬКО ПОКА ЗАЯВКА НОВАЯ (партия 31, решение по INV-03 QA).

QA отменил гостем уже подтверждённые #514–#516 — сервер отвечал 200, хотя
диалог обещал «пока не взяли в работу». Теперь сервер запрещает так же, как
прячет кнопку витрина: правило одно (`guest_can_cancel`).
"""

from __future__ import annotations

import pytest

from tests.conftest import host_for
from tests.orders.api.test_tracker_api import place_guest_order

pytestmark = pytest.mark.django_db


def _guest(client, hotel, token):
    return {"HTTP_HOST": host_for(hotel), "HTTP_AUTHORIZATION": f"Bearer {token}"}


def test_new_order_can_be_cancelled_by_the_guest(client, crystal):
    placed = place_guest_order(client, crystal, key="gc-new")
    order, token = placed["order"], placed["token"]
    view = client.get(f"/api/guest/order/{order['id']}", **_guest(client, crystal, token)).json()
    assert view["status"]["allows_guest_cancel"] is True
    response = client.post(
        f"/api/guest/order/{order['id']}/cancel", data={}, content_type="application/json", **_guest(client, crystal, token)
    )
    assert response.status_code == 200, response.content


def test_accepted_order_is_refused_and_the_button_is_gone(client, crystal, tracker, django_capture_on_commit_callbacks):
    placed = place_guest_order(client, crystal, key="gc-acc")
    order, token = placed["order"], placed["token"]
    with django_capture_on_commit_callbacks(execute=True):
        assert tracker.post(f"/api/tracker/order/{order['id']}/accept", {}).status_code == 200
    view = client.get(f"/api/guest/order/{order['id']}", **_guest(client, crystal, token)).json()
    assert view["status"]["allows_guest_cancel"] is False
    response = client.post(
        f"/api/guest/order/{order['id']}/cancel", data={}, content_type="application/json", **_guest(client, crystal, token)
    )
    assert response.status_code == 409
    assert response.json()["code"] == "cancel_not_allowed"
    assert "ресепшен" in response.json()["detail"]
