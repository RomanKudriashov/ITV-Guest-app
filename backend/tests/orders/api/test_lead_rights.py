"""
ПРАВА СТАРШЕГО СМЕНЫ, НАЗНАЧЕНИЕ, П.78, П.79 (партия 47).

Набор прав решён тек-лидом 24.09.2026: исполнитель < старший смены <
руководитель < администратор. До партии 47 проверка на доске была одна —
«назначен на точку», и старший смены ничем не отличался от исполнителя.

На кухне Кристалла в сиде старший смены — повар (`chef`, LEAD), руководитель —
`manager.restaurant`. Исполнителя (MEMBER) на кухне сид не заводит, поэтому
бармена здесь привязывают к кухне исполнителем — так проверяется уровень, а не
«не та точка».
"""

from __future__ import annotations

import time

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from tests.conftest import CmsClient, HOTEL_ADMIN, staff_token_for
from tests.orders.api.test_tracker_api import place_guest_order

pytestmark = pytest.mark.django_db


def _staff(client, crystal, login: str) -> CmsClient:
    return CmsClient(client, crystal, staff_token_for(client, crystal, login))


def _user(crystal, login: str) -> User:
    with tenant_context(crystal):
        return User.objects.get(email=f"{login}@crystal.local")


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        return ExecutionPoint.objects.get(code="kitchen")


@pytest.fixture
def barman_on_kitchen(crystal, kitchen):
    """Бармен — ещё и исполнитель (MEMBER) кухни."""
    with tenant_context(crystal):
        StaffAssignment.objects.create(
            hotel_id=crystal.pk, user=_user(crystal, "barman"), execution_point=kitchen,
            level=StaffAssignment.Level.MEMBER,
        )


@pytest.fixture
def order(client, crystal, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return place_guest_order(client, crystal, key="lead-1")["order"]


def _db(crystal, order_id) -> Order:
    with tenant_context(crystal):
        return Order.objects.select_related("status").get(pk=order_id)


def _close(client_, order_id):
    """Довести заказ до «Доставлено» (закрыть)."""
    response = client_.post(f"/api/tracker/order/{order_id}/status", {"status": "done"})
    assert response.status_code == 200, response.content


# --- а) право по уровню ------------------------------------------------------


def test_the_board_carries_the_viewers_rights(client, crystal, barman_on_kitchen):
    lead = _staff(client, crystal, "chef").get("/api/tracker/orders?point=kitchen").json()
    member = _staff(client, crystal, "barman").get("/api/tracker/orders?point=kitchen").json()
    assert lead["rights"]["assign"] and lead["rights"]["reopen"]
    assert not member["rights"]["assign"] and not member["rights"]["reopen"]
    assert member["rights"]["cancel"] and member["rights"]["accept"]


# --- в) вернуть закрытый ------------------------------------------------------


def test_a_member_cannot_reopen_a_closed_order(client, crystal, order, barman_on_kitchen):
    """УКУС. Исполнитель возвращает закрытый → 403; на прежнем коде проходило."""
    _close(_staff(client, crystal, "chef"), order["id"])
    member = _staff(client, crystal, "barman")

    refused = member.post(
        f"/api/tracker/order/{order['id']}/status", {"status": "preparing", "comment": "ошибка"}
    )
    assert refused.status_code == 403, refused.content
    assert refused.json()["code"] == "level_too_low"
    assert _db(crystal, order["id"]).status.code == "done"

    card = member.get(f"/api/tracker/order/{order['id']}").json()
    assert card["rights"]["reopen"] is False
    assert card["next_statuses"] == [], "у исполнителя на закрытой карточке нет целей возврата"


def test_a_lead_reopens_only_with_a_reason_and_the_reason_is_in_history(client, crystal, order):
    lead = _staff(client, crystal, "chef")
    _close(lead, order["id"])

    no_reason = lead.post(f"/api/tracker/order/{order['id']}/status", {"status": "preparing"})
    assert no_reason.status_code == 422
    assert no_reason.json()["code"] == "reopen_reason_required"

    done = lead.post(
        f"/api/tracker/order/{order['id']}/status",
        {"status": "preparing", "comment": "гость вернул блюдо"},
    )
    assert done.status_code == 200, done.content
    assert any(
        entry.get("kind") == "status" and entry["comment"] == "гость вернул блюдо"
        for entry in done.json()["journal"]
    )


# --- г) отмена — без изменений ----------------------------------------------


def test_a_member_still_cancels_with_a_reason(client, crystal, order, barman_on_kitchen):
    member = _staff(client, crystal, "barman")
    cancelled = member.post(
        f"/api/tracker/order/{order['id']}/cancel", {"cancel_reason": "mistake"}
    )
    assert cancelled.status_code == 200, cancelled.content


# --- б) назначение -----------------------------------------------------------


def test_a_lead_assigns_without_accepting_and_history_names_both(client, crystal, order):
    lead = _staff(client, crystal, "chef")
    manager = _user(crystal, "manager.restaurant")

    assigned = lead.post(f"/api/tracker/order/{order['id']}/assign", {"assignee": str(manager.pk)})
    assert assigned.status_code == 200, assigned.content
    body = assigned.json()
    assert body["assignee"]["id"] == str(manager.pk)

    stored = _db(crystal, order["id"])
    assert stored.status.code == order["status"]["code"], "назначение сменило статус"
    assert stored.accepted_at is None, "назначение поставило «принято»"

    entry = next(e for e in body["journal"] if e.get("kind") == "assign")
    assert entry["actor_name"] == "Пётр, повар"
    assert entry["assignee_name"] == "Сергей, управляющий «Панорамой»"


def test_a_lead_cannot_assign_a_person_from_another_point(client, crystal, order):
    """УКУС. Горничная не стоит на кухне — назначить её на заказ кухни нельзя."""
    lead = _staff(client, crystal, "chef")
    maid = _user(crystal, "maid")
    refused = lead.post(f"/api/tracker/order/{order['id']}/assign", {"assignee": str(maid.pk)})
    assert refused.status_code == 422, refused.content
    assert refused.json()["code"] == "assignee_not_on_point"
    assert _db(crystal, order["id"]).assignee_id is None


def test_a_member_cannot_assign(client, crystal, order, barman_on_kitchen):
    member = _staff(client, crystal, "barman")
    refused = member.post(
        f"/api/tracker/order/{order['id']}/assign", {"assignee": str(_user(crystal, "chef").pk)}
    )
    assert refused.status_code == 403
    assert refused.json()["code"] == "level_too_low"


def test_escalation_goes_on_after_assignment_until_accept(client, crystal, order, barman_on_kitchen):
    """УКУС. Назначили — эскалация идёт; «Принять» назначенного — гаснет."""
    from apps.notifications.services.delivery import escalation_should_stop

    lead = _staff(client, crystal, "chef")
    barman = _user(crystal, "barman")
    lead.post(f"/api/tracker/order/{order['id']}/assign", {"assignee": str(barman.pk)})
    assert not escalation_should_stop(_db(crystal, order["id"])), "назначение погасило эскалацию"

    # Заказ, назначенный другому, перехватить нельзя.
    stolen = lead.post(f"/api/tracker/order/{order['id']}/accept")
    assert stolen.status_code == 409
    assert stolen.json()["code"] == "assigned_to_other"

    accepted = _staff(client, crystal, "barman").post(f"/api/tracker/order/{order['id']}/accept")
    assert accepted.status_code == 200, accepted.content
    assert escalation_should_stop(_db(crystal, order["id"]))


def test_the_assignee_sees_assigned_to_you_and_gets_the_event(
    client, crystal, order, barman_on_kitchen, django_capture_on_commit_callbacks, settings
):
    from apps.notifications.models import EventRecord

    settings.NOTIFICATIONS_ENABLED = True
    barman = _user(crystal, "barman")
    with django_capture_on_commit_callbacks(execute=True):
        _staff(client, crystal, "chef").post(
            f"/api/tracker/order/{order['id']}/assign", {"assignee": str(barman.pk)}
        )
    card = _staff(client, crystal, "barman").get(f"/api/tracker/order/{order['id']}").json()
    assert card["assigned_to_me"] is True
    assert card["rights"]["accept"] is True
    with tenant_context(crystal):
        record = EventRecord.objects.filter(code="order.assigned").order_by("-created_at").first()
        assert record is not None, "событие назначения не записано"
        assert record.payload.get("by_name") == "Пётр, повар"


# --- д) п.78: чтение и сокет ---------------------------------------------------


def test_a_barman_cannot_read_a_kitchen_order(client, crystal, order):
    """УКУС. `GET /orders/{id}` — только своя точка; бармен заказ кухни не читает."""
    refused = _staff(client, crystal, "barman").get(f"/api/orders/{order['id']}")
    assert refused.status_code == 403, refused.status_code
    assert _staff(client, crystal, "chef").get(f"/api/orders/{order['id']}").status_code == 200


@pytest.mark.django_db(transaction=True)
def test_removing_the_cook_from_the_kitchen_closes_his_open_board(client, crystal):
    """УКУС. Сняли повара с кухни — его открытая доска закрыта ≤ 5 с (код 4403)."""
    from config.asgi import application

    token = staff_token_for(client, crystal, "chef")
    admin = CmsClient(client, crystal, staff_token_for(client, crystal, HOTEL_ADMIN))
    chef = _user(crystal, "chef")
    with tenant_context(crystal):
        bar = ExecutionPoint.objects.get(code="bar")

    @database_sync_to_async
    def move_chef_to_bar():
        response = admin.patch(
            f"/api/cms/staff/{chef.pk}",
            {"assignments": [{"execution_point_id": str(bar.pk), "level": "member"}]},
        )
        assert response.status_code == 200, response.content

    async def scenario():
        board = WebsocketCommunicator(application, f"/ws/tracker/kitchen/?token={token}&hotel=crystal&lang=ru")
        assert (await board.connect(timeout=10))[0]
        assert (await board.receive_json_from(timeout=10))["event"] == "connected"

        started = time.monotonic()
        await move_chef_to_bar()
        code = None
        for _ in range(10):
            output = await board.receive_output(timeout=5)
            if output["type"] == "websocket.close":
                code = output.get("code")
                break
        assert code == 4403
        assert time.monotonic() - started <= 5

    async_to_sync(scenario)()


# --- е) п.79: «Поручение» -----------------------------------------------------


def test_an_errand_card_says_who_and_from_where_not_for_the_guest(client, crystal):
    """УКУС. На «Поручении» нет «за гостя»: точка-источник и кто дал."""
    from apps.chat.models import ChatThread
    from apps.chat.services.desk_order import hand_over

    reception = _user(crystal, "reception")
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="reception")
        thread = ChatThread.objects.create(hotel_id=crystal.pk, execution_point=point)
        order, _title = hand_over(thread, point_code="housekeeping", text="Полотенца в 212", user=reception, language="ru")

    card = _staff(client, crystal, "maid").get(f"/api/tracker/order/{order.pk}").json()
    assert card["placed_by"] is None, "у поручения не «Оформил за гостя»"
    assert card["errand"]["by"] == "Игорь, ресепшен"
    assert card["errand"]["from_point"]
    assert "за гостя" not in str(card)
