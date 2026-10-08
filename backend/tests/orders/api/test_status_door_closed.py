"""
ЧУЖАЯ ТОЧКА — НИ ОДНОЙ ДОРОГИ К СТАТУСУ (партия 46).

`POST /orders/{id}/status` была обходной дверью: любой сотрудник отеля менял
любой статус любому заказу — без проверки точки и без проверки переходов.
Ручка убрана. Здесь — укус: бармен (точка «бар») пробует тронуть заказ кухни
ВСЕМИ оставшимися дорогами, и ни одна не пускает; статус заказа не меняется.
На прежнем коде обходная ручка отвечала 200 и переводила заказ.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.orders.models import Order
from tests.conftest import CmsClient, staff_token_for
from tests.orders.api.test_tracker_api import place_guest_order

pytestmark = pytest.mark.django_db


@pytest.fixture
def kitchen_order(client, crystal, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return place_guest_order(client, crystal, key="door-1")["order"]


@pytest.fixture
def barman(client, crystal):
    """Линейный сотрудник бара: к кухне не привязан."""
    return CmsClient(client, crystal, staff_token_for(client, crystal, "barman"))


def _status(crystal, order_id) -> str:
    with tenant_context(crystal):
        return Order.objects.select_related("status").get(pk=order_id).status.code


def test_a_stranger_point_cannot_move_the_order_by_any_road(crystal, kitchen_order, barman):
    order_id = kitchen_order["id"]
    before = _status(crystal, order_id)

    roads = {
        "обходная (убрана)": barman.post(f"/api/orders/{order_id}/status", {"status": "done"}),
        "трекер: статус": barman.post(f"/api/tracker/order/{order_id}/status", {"status": "done"}),
        "трекер: принять": barman.post(f"/api/tracker/order/{order_id}/accept"),
        "трекер: отмена": barman.post(
            f"/api/tracker/order/{order_id}/cancel", {"cancel_reason": "mistake"}
        ),
        "трекер: порядок": barman.post(
            f"/api/tracker/order/{order_id}/position", {"after": None, "before": None}
        ),
    }
    passed = {name: r.status_code for name, r in roads.items() if r.status_code < 400}
    assert not passed, f"чужая точка прошла: {passed}"
    assert _status(crystal, order_id) == before, "статус заказа кухни изменился"


def test_the_own_point_still_moves_it(crystal, kitchen_order, client):
    """Контроль: повар кухни свою доску двигает — запрет не задел законную дорогу."""
    chef = CmsClient(client, crystal, staff_token_for(client, crystal, "chef"))
    order_id = kitchen_order["id"]
    moved = chef.post(f"/api/tracker/order/{order_id}/status", {"status": "preparing"})
    assert moved.status_code == 200, moved.content
    assert _status(crystal, order_id) == "preparing"
