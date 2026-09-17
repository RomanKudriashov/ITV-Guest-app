"""
Расследование отзыва: заказ, части, кто вёл, сколько шло, просрочка по
снимку порога, эскалации и переписка гостя за время заказа.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from tests.chat.api.test_chat_reviews import guest_for
from tests.reviews.test_reviews_section import _as, two_venue_review  # noqa: F401
from tests.orders.api.test_guest_service_cart import aggregator  # noqa: F401

pytestmark = pytest.mark.django_db


def _place(guest, key) -> str:
    menu = guest.get("/api/guest/catalog?type=product").json()
    item_id = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    return guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY=key,
    ).json()["id"]


def test_the_card_tells_who_how_long_and_whether_it_was_late(client, crystal, cms):
    guest = guest_for(client, crystal, room="212")
    guest.post("/api/guest/chat", {"body": "Где мой салат?"})  # до заказа — в окне
    order_id = _place(guest, "inv-late")
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        chef = User.objects.get(email="chef@crystal.local")
        change_status(get_order(order_id), to_code="accepted", actor_type="staff", actor_id=chef.pk)
        change_status(get_order(order_id), to_code="done", actor_type="staff", actor_id=chef.pk)
        # Заказ шёл 50 минут при снимке порога 20.
        now = timezone.now()
        Order.objects.filter(pk=order_id).update(
            created_at=now - timedelta(minutes=50),
            accepted_at=now - timedelta(minutes=45),
            closed_at=now,
            sla_minutes=20,
        )
        # Настройку точки после этого подняли — прошлое не переписывается.
        ExecutionPoint.objects.filter(code="kitchen").update(sla_minutes=120)
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 1, "comment": "холодно"}).json()["id"]

    body = cms.get(f"/api/cms/reviews/{review_id}").json()
    assert body["order"]["lines"][0]["quantity"] == 1
    [part] = body["parts"]
    assert part["point"]["title"]
    assert part["assignee"], "видно, кто вёл"
    assert part["reaction_minutes"] == 5
    assert part["work_minutes"] == 50 and part["sla_minutes"] == 20
    assert part["was_overdue"] is True and part["overdue_minutes"] == 30, "судим по снимку, а не по 120"
    assert [step["by"] for step in part["history"] if step["by"]], "видно, кто двигал статусы"
    assert [m["body"] for m in body["chat"]] == ["Где мой салат?"]


def test_chat_of_another_guest_is_not_in_the_card(client, crystal, cms):
    other = guest_for(client, crystal, room="212")
    other.post("/api/guest/chat", {"body": "чужое сообщение"})
    guest = guest_for(client, crystal, room="212")
    order_id = _place(guest, "inv-foreign")
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        change_status(get_order(order_id), to_code="done", actor_type="staff")
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 2}).json()["id"]
    assert cms.get(f"/api/cms/reviews/{review_id}").json()["chat"] == []


def test_a_two_venue_review_lists_each_part(client, crystal, cms, two_venue_review):  # noqa: F811
    parts = cms.get(f"/api/cms/reviews/{two_venue_review}").json()["parts"]
    assert len(parts) == 2
    assert all(part["sla_minutes"] for part in parts), "снимок порога есть у каждой части"


def test_another_venue_manager_cannot_open_the_card(client, crystal, two_venue_review):  # noqa: F811
    assert _as(client, crystal, "manager.spa").get(f"/api/cms/reviews/{two_venue_review}").status_code == 404
    assert _as(client, crystal, "manager.bar").get(f"/api/cms/reviews/{two_venue_review}").status_code == 200


def test_garbage_id_is_a_404(cms):
    assert cms.get("/api/cms/reviews/not-a-uuid").status_code == 404


def test_new_orders_carry_the_sla_snapshot(client, crystal):
    guest = guest_for(client, crystal, room="212")
    order_id = _place(guest, "inv-snapshot")
    with tenant_context(crystal):
        from apps.orders.services.tracker_types import effective_sla_minutes

        order = Order.objects.select_related("execution_point").get(pk=order_id)
        assert order.sla_minutes == effective_sla_minutes(order.execution_point)


def test_only_steps_that_fired_late_count_as_escalations(client, crystal, cms):
    from apps.notifications.models import EscalationRule, EscalationStep, NotificationLog

    guest = guest_for(client, crystal, room="212")
    order_id = _place(guest, "inv-escalation")
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        change_status(get_order(order_id), to_code="done", actor_type="staff")
        rule = EscalationRule.objects.create(name="разбор", execution_point=ExecutionPoint.objects.get(code="kitchen"))
        now_step = EscalationStep.objects.create(rule=rule, sort_order=0, delay_minutes=0)
        late_step = EscalationStep.objects.create(rule=rule, sort_order=1, delay_minutes=20)
        order = Order.objects.get(pk=order_id)
        for key, step, status in (
            ("now", now_step, "sent"),        # «сразу в отдел» — не эскалация
            ("late", late_step, "sent"),      # сработала — эскалация
            ("gone", late_step, "cancelled"), # погашена — нет
        ):
            NotificationLog.objects.create(
                hotel=crystal, order=order, rule=rule, step=step, step_index=step.sort_order,
                status=status, dedupe_key=f"inv-{key}-{order_id}", sent_at=timezone.now(),
            )
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 2}).json()["id"]
    [part] = cms.get(f"/api/cms/reviews/{review_id}").json()["parts"]
    assert len(part["escalations"]) == 1
