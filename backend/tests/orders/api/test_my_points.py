"""
«МОИ ТОЧКИ» (партия 49, решение тек-лида 9а).

Скоуп как у трекера: назначенные точки, администратору — все активные. Строка
точки — сводка смены этой точки, та же, что плитка на её доске.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from tests.conftest import CmsClient, staff_token_for
from tests.orders.api.test_tracker_api import place_guest_order

pytestmark = pytest.mark.django_db


def _staff(client, crystal, login: str) -> CmsClient:
    return CmsClient(client, crystal, staff_token_for(client, crystal, login))


def _codes(response) -> list[str]:
    assert response.status_code == 200, response.content
    return [row["code"] for row in response.json()["points"]]


def test_a_person_with_two_points_sees_both_and_not_a_stranger(client, crystal):
    """УКУС. Повар на кухне и на баре — видит обе; хозслужбы, где его нет, — нет."""
    with tenant_context(crystal):
        StaffAssignment.objects.create(
            hotel_id=crystal.pk,
            user=User.objects.get(email="chef@crystal.local"),
            execution_point=ExecutionPoint.objects.get(code="bar"),
            level=StaffAssignment.Level.MEMBER,
        )
    codes = _codes(_staff(client, crystal, "chef").get("/api/tracker/my-points"))
    assert sorted(codes) == ["bar", "kitchen"], codes
    assert "housekeeping" not in codes


def test_the_admin_sees_every_active_point(client, crystal):
    """УКУС. Администратор отеля — все активные точки, выключенная — нет."""
    with tenant_context(crystal):
        ExecutionPoint.objects.filter(code="spa").update(is_active=False)
        active = sorted(ExecutionPoint.objects.filter(is_active=True).values_list("code", flat=True))
    codes = _codes(_staff(client, crystal, "owner").get("/api/tracker/my-points"))
    assert sorted(codes) == active
    assert "spa" not in codes


def test_a_row_matches_the_shift_tile_of_that_board(client, crystal, django_capture_on_commit_callbacks):
    """Строка точки — та же сводка, что плитка смены на её доске, и без карточек."""
    with django_capture_on_commit_callbacks(execute=True):
        place_guest_order(client, crystal, key="my-points-1")
    chef = _staff(client, crystal, "chef")
    row = next(r for r in chef.get("/api/tracker/my-points").json()["points"] if r["code"] == "kitchen")
    tile = chef.get("/api/tracker/orders?point=kitchen").json()["shift"]
    assert row["summary"] == {
        field: tile[field] for field in ("new", "in_work", "overdue", "done", "median_accept_minutes")
    }
    assert row["summary"]["new"] >= 1
    assert row["level"] == StaffAssignment.Level.LEAD
    assert "columns" not in row and "orders" not in row


def test_nobody_without_a_point_gets_an_empty_list(client, crystal):
    with tenant_context(crystal):
        StaffAssignment.objects.filter(user__email="maid@crystal.local").delete()
    assert _codes(_staff(client, crystal, "maid").get("/api/tracker/my-points")) == []


def test_queries_do_not_grow_with_done_orders_or_beyond_three_per_point(
    client, crystal, django_capture_on_commit_callbacks
):
    """
    УКУС. Экран опрашивается раз в 30 с, и число запросов не имеет права расти
    с заказами смены: `closed_at` догружался по запросу на каждый сделанный
    заказ, сервис точки — по четыре раза на строку.
    """
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    from apps.orders.services import status_flows
    from apps.orders.services.tracker import my_points_payload

    def close_some(count: int, tag: str) -> None:
        chef = _staff(client, crystal, "chef")
        for i in range(count):
            with django_capture_on_commit_callbacks(execute=True):
                placed = place_guest_order(client, crystal, key=f"my-points-q-{tag}-{i}")["order"]
            with tenant_context(crystal):
                done = status_flows.terminal_status(_flow_of(placed["id"]))
            assert chef.post(f"/api/tracker/order/{placed['id']}/status", {"status": done.code}).status_code == 200

    def measure() -> tuple[int, int]:
        with tenant_context(crystal, language="ru"):
            admin = User.objects.get(email="owner@crystal.local")
            with CaptureQueriesContext(connection) as captured:
                rows = my_points_payload(admin, "ru")["points"]
        return len(captured), len(rows)

    close_some(2, "a")
    first, points = measure()
    close_some(3, "b")
    second, _ = measure()
    assert second == first, f"запросов стало больше с заказами смены: {first} → {second}"
    assert first <= 3 * points + 6, f"{first} запросов на {points} точек"


def _flow_of(order_id):
    from apps.orders.models import Order

    return Order.objects.select_related("status").get(pk=order_id).status.flow
