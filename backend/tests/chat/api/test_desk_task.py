"""
Задача в отдел «Поручением»: обычный заказ по доске отдела, невидимый гостю.

Переписка при этом остаётся у ресепшена — отдел получает задачу, а не диалог.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.models import Order
from tests.chat.api.test_chat_reviews import guest_for, staff_call

pytestmark = pytest.mark.django_db


@pytest.fixture
def dialog(client, crystal):
    guest = guest_for(client, crystal, room="212")
    return guest, guest.post("/api/guest/chat", {"body": "в номере холодно"}).json()["thread_id"]


def _hand_over(desk, thread_id, point="housekeeping", text="принести обогреватель"):
    return desk(f"/api/tracker/desk/threads/{thread_id}/task", "post", {"point": point, "text": text})


def test_the_task_goes_to_the_department_board_as_a_normal_order(client, crystal, dialog):
    guest, thread_id = dialog
    desk = staff_call(client, crystal, "reception")

    response = _hand_over(desk, thread_id)
    assert response.status_code == 201, response.content
    task = response.json()
    assert task["point_title"]

    with tenant_context(crystal):
        order = Order.objects.get(pk=task["id"])
        assert order.execution_point.code == "housekeeping"
        assert order.comment == "принести обогреватель"
        assert order.room.number == "212"
        assert order.placed_by.email == "reception@crystal.local"
        assert order.source_thread_id is not None
        assert order.guest_session_id is None, "задача — не заказ гостя"
        assert order.items.first().item.is_internal is True
        # Доска отдела показывает её обычной карточкой, со статусами.
        assert order.status.is_initial

    board = staff_call(client, crystal, "maid")("/api/tracker/orders?point=housekeeping").json()
    numbers = {entry["number"] for column in board["columns"] for entry in column["orders"]}
    assert task["number"] in numbers, "задача на доске хозслужбы"


def test_the_guest_never_sees_the_errand(client, crystal, dialog):
    guest, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    _hand_over(desk, thread_id, point="kitchen", text="проверить заказ")

    menu = guest.get("/api/guest/catalog?type=service_request").json()
    titles = {item["title"] for category in menu["categories"] for item in category["items"]}
    assert "Поручение" not in titles, "витрина"
    products = guest.get("/api/guest/catalog?type=product").json()
    assert "Поручение" not in {i["title"] for c in products["categories"] for i in c["items"]}

    found = guest.get("/api/guest/search?q=Поручение").json()
    assert not found["items"], "поиск"

    home = guest.get("/api/guest/home").json()
    assert all("errand" not in (tile.get("key") or "") for tile in home["tiles"]), "витрина главной"

    mine = guest.get("/api/guest/orders").json()
    assert not [o for o in mine["active"] + mine["past"] if o["number"] == 0], "своих заказов не прибавилось"
    with tenant_context(crystal):
        assert not Order.objects.filter(
            guest_session__isnull=False, items__item__is_internal=True
        ).exists()


def test_the_errand_is_not_a_sale_in_analytics(client, crystal, dialog, django_capture_on_commit_callbacks):
    from apps.analytics.models import AnalyticsEvent

    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    with django_capture_on_commit_callbacks(execute=True):
        task = _hand_over(desk, thread_id).json()
    with tenant_context(crystal):
        assert not AnalyticsEvent.objects.filter(order_id=task["id"]).exists(), "аналитика"


def test_the_guest_hears_it_in_words_and_keeps_writing_to_the_reception(client, crystal, dialog):
    guest, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    task = _hand_over(desk, thread_id).json()

    chat = guest.get("/api/guest/chat").json()
    note = chat["messages"][-1]
    assert "Передали" in note["body"] and "№" not in note["body"], "по-человечески, без номера заказа"
    assert note["author_name"] == "Ресепшен"
    assert chat["counterpart"] == "Ресепшен"

    # Тред у ресепшена и остаётся: хозслужба его не получает.
    with tenant_context(crystal):
        from apps.chat.models import ChatThread

        assert ChatThread.objects.get(pk=thread_id).execution_point.code == "reception"
    assert staff_call(client, crystal, "maid")("/api/tracker/chat/threads").status_code == 403

    card = desk(f"/api/tracker/chat/threads/{thread_id}/guest").json()
    assert [t["number"] for t in card["tasks"]] == [task["number"]]
    assert card["tasks"][0]["status"]["title"] and card["tasks"][0]["comment"] == "принести обогреватель"


def test_an_empty_task_and_a_wrong_department_are_refused(client, crystal, dialog):
    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    empty = _hand_over(desk, thread_id, text="   ")
    assert empty.status_code == 422 and empty.json()["code"] == "empty_task"
    wrong = _hand_over(desk, thread_id, point="nowhere")
    assert wrong.status_code == 422 and wrong.json()["code"] == "point_not_found"


def test_only_the_desk_hands_over(client, crystal, dialog):
    _, thread_id = dialog
    cook = staff_call(client, crystal, "chef")
    assert _hand_over(cook, thread_id).status_code == 403
    assert cook("/api/tracker/desk/points").status_code == 403


def test_the_department_list_excludes_the_reception_itself(client, crystal):
    points = staff_call(client, crystal, "reception")("/api/tracker/desk/points").json()["points"]
    codes = {p["code"] for p in points}
    assert "housekeeping" in codes and "reception" not in codes
    assert all(p["public_title"] for p in points)


def test_the_errand_item_is_created_once(client, crystal, dialog):
    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    _hand_over(desk, thread_id)
    _hand_over(desk, thread_id, text="ещё раз")
    with tenant_context(crystal):
        assert Item.objects.filter(code="errand-housekeeping").count() == 1


def test_a_deleted_errand_item_is_revived(client, crystal, dialog):
    """
    Служебную позицию мог унести кто угодно — уборка стенда, чужая правка
    каталога. Код остаётся занятым, и передача задачи падала бы 409.
    """
    _, thread_id = dialog
    desk = staff_call(client, crystal, "reception")
    _hand_over(desk, thread_id)
    with tenant_context(crystal):
        Item.objects.filter(code="errand-housekeeping").delete()  # мягко
        assert not Item.objects.filter(code="errand-housekeeping").exists()

    again = _hand_over(desk, thread_id, text="ещё задача")
    assert again.status_code == 201, again.content
    with tenant_context(crystal):
        assert Item.all_objects.filter(code="errand-housekeeping").count() == 1
        assert Item.objects.get(code="errand-housekeeping").is_internal is True
