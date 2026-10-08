"""
ПЕРЕНОС ЗАКАЗА МЕЖДУ ДОСКАМИ (партия 48).

Решения тек-лида: статус — в начальный статус потока новой точки; переносится
только незавершённый заказ без брони, не часть составного и не его родитель;
исполнитель и «принято» сброшены; норма времени — от переноса; эскалация
старой точки гаснет, новой — планируется от переноса; перенос — в свой журнал.

Кухня Кристалла: повар `chef` — старший смены (LEAD); хозслужба — горничная
`maid` (MEMBER). Бармена привязывают к кухне исполнителем там, где проверяется
уровень, а не «не та точка».
"""

from __future__ import annotations

import time
from datetime import timedelta

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from tests.conftest import CmsClient, staff_token_for
from tests.orders.api.test_tracker_api import place_guest_order

pytestmark = pytest.mark.django_db


def _staff(client, crystal, login: str) -> CmsClient:
    return CmsClient(client, crystal, staff_token_for(client, crystal, login))


def _user(crystal, login: str) -> User:
    with tenant_context(crystal):
        return User.objects.get(email=f"{login}@crystal.local")


def _db(crystal, order_id) -> Order:
    with tenant_context(crystal):
        return Order.objects.select_related("status", "execution_point").get(pk=order_id)


@pytest.fixture
def order(client, crystal, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return place_guest_order(client, crystal, key="transfer-1")["order"]


def _transfer(client_, order_id, point="housekeeping", reason="уборка, а не кухня"):
    return client_.post(f"/api/tracker/order/{order_id}/transfer", {"point": point, "reason": reason})


# --- б) право и запреты --------------------------------------------------------


def test_a_member_cannot_transfer(client, crystal, order):
    """УКУС. Исполнитель кухни переносит — 403 `level_too_low`."""
    with tenant_context(crystal):
        StaffAssignment.objects.create(
            hotel_id=crystal.pk, user=_user(crystal, "barman"),
            execution_point=ExecutionPoint.objects.get(code="kitchen"),
            level=StaffAssignment.Level.MEMBER,
        )
    refused = _transfer(_staff(client, crystal, "barman"), order["id"])
    assert refused.status_code == 403, refused.content
    assert refused.json()["code"] == "level_too_low"
    assert _db(crystal, order["id"]).execution_point.code == "kitchen"


def test_a_lead_cannot_transfer_a_part_of_a_composite_order(client, crystal, order, django_capture_on_commit_callbacks):
    """УКУС. Часть составного заказа не переносят — 422 `transfer_part_of_composite`."""
    with django_capture_on_commit_callbacks(execute=True):
        other = place_guest_order(client, crystal, key="transfer-parent")["order"]
    with tenant_context(crystal):
        Order.objects.filter(pk=order["id"]).update(parent_id=other["id"])
    refused = _transfer(_staff(client, crystal, "chef"), order["id"])
    assert refused.status_code == 422, refused.content
    assert refused.json()["code"] == "transfer_part_of_composite"


def test_a_reason_is_required_and_the_target_must_differ(client, crystal, order):
    lead = _staff(client, crystal, "chef")
    assert _transfer(lead, order["id"], reason="  ").json()["code"] == "transfer_reason_required"
    assert _transfer(lead, order["id"], point="kitchen").json()["code"] == "transfer_same_point"
    assert _transfer(lead, order["id"], point="nowhere").json()["code"] == "transfer_point_not_found"


# --- а), б) после переноса -------------------------------------------------------


def test_after_transfer_status_is_initial_no_assignee_and_waiting_from_transfer(client, crystal, order):
    """
    УКУС. После переноса на новой доске статус — начальный потока новой точки,
    исполнителя нет, «ждёт» и норма времени — от момента переноса.
    """
    lead = _staff(client, crystal, "chef")
    assert lead.post(f"/api/tracker/order/{order['id']}/accept").status_code == 200

    moved = _transfer(lead, order["id"])
    assert moved.status_code == 200, moved.content

    stored = _db(crystal, order["id"])
    assert stored.execution_point.code == "housekeeping"
    assert stored.status.is_initial, f"статус не начальный: {stored.status.code}"
    assert stored.assignee_id is None and stored.accepted_at is None
    assert stored.transferred_at is not None

    from apps.orders.services.tracker_types import work_clock_start

    assert work_clock_start(stored) == stored.transferred_at

    card = _staff(client, crystal, "maid").get(f"/api/tracker/order/{order['id']}").json()
    assert card["waiting_minutes"] == 0
    kinds = [entry.get("kind") for entry in card["journal"]]
    assert "transfer" in kinds, "перенос не попал в журнал заказа"
    assert any(e.get("kind") == "assign" and e.get("reason") == "transfer" for e in card["journal"]), (
        "снятие исполнителя переносом не записано"
    )
    from apps.orders.models import OrderTransfer

    with tenant_context(crystal):
        record = OrderTransfer.objects.get(order_id=order["id"])
        assert (record.number, record.actor_name, record.reason) == (1, "Пётр, повар", "уборка, а не кухня")


def test_the_guest_sees_where_the_order_went(client, crystal, django_capture_on_commit_callbacks):
    """УКУС. Гость видит «Передали в «…»» — гостевым названием сервиса новой точки."""
    with django_capture_on_commit_callbacks(execute=True):
        placed = place_guest_order(client, crystal, key="transfer-guest")
    _transfer(_staff(client, crystal, "chef"), placed["order"]["id"])
    from tests.conftest import host_for

    seen = client.get(
        f"/api/guest/order/{placed['order']['id']}",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {placed['token']}",
    ).json()
    assert seen["transfer"] is not None
    with tenant_context(crystal):
        from apps.core.fields import translate
        from apps.hotels.models import Service

        expected = translate(Service.objects.get(execution_point__code="housekeeping").public_name, "ru")
    assert seen["transfer"]["to"] == expected


# --- в) эскалация ---------------------------------------------------------------


def test_old_steps_are_cancelled_and_new_ones_planned_from_the_transfer(
    client, crystal, order, settings, monkeypatch, django_capture_on_commit_callbacks
):
    """УКУС. Ступени старой точки погашены; новой — от момента переноса, с номером переноса в ключе."""
    from apps.notifications.models import EscalationRule, EscalationStep, NotificationLog, NotificationStatus
    from apps.notifications.services import plan_escalation
    from apps.notifications import tasks

    settings.NOTIFICATIONS_ENABLED = True
    monkeypatch.setattr(tasks.plan_escalation_task, "delay", lambda *a: tasks.plan_escalation_task(*a))
    with tenant_context(crystal):
        housekeeping = ExecutionPoint.objects.get(code="housekeeping")
        if not EscalationRule.objects.filter(execution_point=housekeeping, is_active=True).exists():
            rule = EscalationRule.objects.create(name="Хозслужба", execution_point=housekeeping)
            EscalationStep.objects.create(rule=rule, delay_minutes=7, sort_order=1)
        old = plan_escalation(_db(crystal, order["id"]))
    assert old, "у кухни нет ступеней — проверка без смысла"

    with django_capture_on_commit_callbacks(execute=True):
        assert _transfer(_staff(client, crystal, "chef"), order["id"]).status_code == 200

    stored = _db(crystal, order["id"])
    with tenant_context(crystal):
        statuses = set(
            NotificationLog.objects.filter(pk__in=[log.pk for log in old if log.scheduled_for > stored.created_at])
            .values_list("status", flat=True)
        )
        assert statuses <= {NotificationStatus.CANCELLED}, f"ступени старой точки живы: {statuses}"
        fresh = list(
            NotificationLog.objects.filter(order_id=order["id"], dedupe_key__contains=":t1:", parent__isnull=True)
        )
        assert fresh, "ступени новой точки не запланированы"
        rule = EscalationRule.objects.get(execution_point__code="housekeeping", is_active=True)
        for log in fresh:
            step = rule.steps.get(pk=log.step_id)
            expected = stored.transferred_at + timedelta(minutes=step.delay_minutes) if step.delay_minutes else stored.transferred_at
            assert abs((log.scheduled_for - expected).total_seconds()) < 1, "ступень новой точки не от момента переноса"


# --- д) старая доска убирает карточку --------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_the_old_board_drops_the_card_without_reload(client, crystal):
    """УКУС. Доска кухни открыта; заказ передали в хозслужбу — карточка уходит ≤ 5 с."""
    from config.asgi import application

    placed = place_guest_order(client, crystal, key="transfer-socket")["order"]
    token = staff_token_for(client, crystal, "chef")
    lead = _staff(client, crystal, "chef")

    def ids(board):
        found = []

        def walk(node):
            if isinstance(node, dict):
                if "next_statuses" in node and "id" in node:
                    found.append(node["id"])
                    return
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(board)
        return found

    @database_sync_to_async
    def move():
        assert _transfer(lead, placed["id"]).status_code == 200

    async def scenario():
        board = WebsocketCommunicator(application, f"/ws/tracker/kitchen/?token={token}&hotel=crystal&lang=ru")
        assert (await board.connect(timeout=10))[0]
        first = await board.receive_json_from(timeout=10)
        assert placed["id"] in ids(first["board"]), "заказа нет на доске кухни до переноса"

        started = time.monotonic()
        await move()
        while time.monotonic() - started < 5:
            message = await board.receive_json_from(timeout=5)
            if message.get("type") == "tracker.snapshot" and placed["id"] not in ids(message["board"]):
                break
        else:
            raise AssertionError("старая доска не убрала карточку за 5 с")
        assert time.monotonic() - started <= 5
        await board.disconnect()

    async_to_sync(scenario)()


# --- г) пересборка аналитики --------------------------------------------------------


def test_rebuilt_analytics_keeps_creation_at_the_old_point_and_work_at_the_new(client, crystal, order):
    """УКУС. Пересборка: создание — за кухней, принятие и выполнение — за хозслужбой."""
    from apps.analytics.models import AnalyticsEvent
    from apps.analytics.services.recompute import rebuild_raw_from_orders

    assert _transfer(_staff(client, crystal, "chef"), order["id"]).status_code == 200
    maid = _staff(client, crystal, "maid")
    assert maid.post(f"/api/tracker/order/{order['id']}/accept").status_code == 200
    stored = _db(crystal, order["id"])
    from apps.orders.services import status_flows

    with tenant_context(crystal):
        done = status_flows.terminal_status(stored.status.flow)
    assert maid.post(f"/api/tracker/order/{order['id']}/status", {"status": done.code}).status_code == 200

    rebuild_raw_from_orders(crystal.pk)
    with tenant_context(crystal):
        kitchen = str(ExecutionPoint.objects.get(code="kitchen").pk)
        housekeeping = str(ExecutionPoint.objects.get(code="housekeeping").pk)
        points = {
            event.kind: event.dimensions.get("point_key")
            for event in AnalyticsEvent.objects.filter(
                order_id=order["id"], kind__in=["order_created", "order_accepted", "order_completed"]
            )
        }
    assert points.get("order_created") == kitchen, points
    assert points.get("order_accepted") == housekeeping, points
    assert points.get("order_completed") == housekeeping, points
