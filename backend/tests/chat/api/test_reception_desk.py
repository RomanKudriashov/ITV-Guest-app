"""
Рабочее место ресепшена: порядок диалогов, «ждёт ответа», подпись отдела
для гостя, карточка гостя и «кто отвечает».
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import StaffSession
from apps.chat.models import ChatThread
from apps.core.context import tenant_context
from apps.hotels.models import Room
from tests.chat.api.test_chat_reviews import _finished_order, guest_for, staff_call

pytestmark = pytest.mark.django_db


def _rows(call, **query):
    path = "/api/tracker/chat/threads?limit=100" + "".join(f"&{k}={v}" for k, v in query.items())
    return call(path).json()["items"]


# --- Список ------------------------------------------------------------------------


def test_unread_first_then_by_the_guests_last_message(client, crystal):
    desk = staff_call(client, crystal, "reception")
    first = guest_for(client, crystal, room="212")
    first_id = first.post("/api/guest/chat", {"body": "первый"}).json()["thread_id"]
    second = guest_for(client, crystal, room="212")
    second_id = second.post("/api/guest/chat", {"body": "второй"}).json()["thread_id"]

    # Первый прочитан и отвечен — ответ ресепшена не поднимает его наверх.
    desk(f"/api/tracker/chat/threads/{first_id}/read", "post", {})
    desk(f"/api/tracker/chat/threads/{first_id}", "post", {"body": "ответ"})
    order = [row["thread_id"] for row in _rows(desk) if row["thread_id"] in {first_id, second_id}]
    assert order == [second_id, first_id], "непрочитанный сверху"

    # Оба прочитаны — выше тот, где гость писал позже, хотя ответ был в другом.
    desk(f"/api/tracker/chat/threads/{second_id}/read", "post", {})
    first.post("/api/guest/chat", {"body": "ещё вопрос"})
    desk(f"/api/tracker/chat/threads/{first_id}/read", "post", {})
    desk(f"/api/tracker/chat/threads/{second_id}", "post", {"body": "свежий ответ второму"})
    order = [row["thread_id"] for row in _rows(desk) if row["thread_id"] in {first_id, second_id}]
    assert order == [first_id, second_id], "по последнему сообщению ГОСТЯ, а не любому"


def test_waiting_and_late(client, crystal):
    desk = staff_call(client, crystal, "reception")
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "алло"}).json()["thread_id"]
    with tenant_context(crystal):
        ChatThread.objects.filter(pk=thread_id).update(
            last_guest_message_at=timezone.now() - timedelta(minutes=25)
        )
    row = next(r for r in _rows(desk) if r["thread_id"] == thread_id)
    assert row["waiting_minutes"] == 25 and row["is_late"] is True

    desk(f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "здесь"})
    row = next(r for r in _rows(desk) if r["thread_id"] == thread_id)
    assert row["waiting_minutes"] is None and row["is_late"] is False, "ответили — не ждёт"


def test_paging_holds_across_the_unread_boundary(client, crystal):
    desk = staff_call(client, crystal, "reception")
    written = []
    for index in range(4):
        guest = guest_for(client, crystal, room="212")
        thread_id = guest.post("/api/guest/chat", {"body": f"q{index}"}).json()["thread_id"]
        written.append(thread_id)
        if index % 2:
            desk(f"/api/tracker/chat/threads/{thread_id}/read", "post", {})
    seen, cursor = [], None
    while True:
        body = desk("/api/tracker/chat/threads?limit=1" + (f"&cursor={cursor}" if cursor else "")).json()
        seen += [item["thread_id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) and set(written) <= set(seen)


# --- Подпись для гостя --------------------------------------------------------------


def test_the_guest_sees_the_department_not_the_employee(client, crystal):
    desk = staff_call(client, crystal, "reception")
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "вопрос"}).json()["thread_id"]
    desk(f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "ответ"})

    mine = guest.get("/api/guest/chat").json()
    assert mine["counterpart"] == "Ресепшен"
    staff_message = next(m for m in mine["messages"] if m["author_type"] == "staff")
    assert staff_message["author_name"] == "Ресепшен", "имя сотрудника гостю не показываем"

    theirs = desk(f"/api/tracker/chat/threads/{thread_id}").json()
    staff_view = next(m for m in theirs["messages"] if m["author_type"] == "staff")
    assert staff_view["author_name"] != "Ресепшен", "смена видит, кто ответил"


# --- Карточка гостя -------------------------------------------------------------------


def test_the_guest_card_knows_the_stay(client, crystal, cms):
    desk = staff_call(client, crystal, "reception")
    before = guest_for(client, crystal, room="212")
    _finished_order(client, crystal, before, key="card-before")
    with tenant_context(crystal):
        room_id = str(Room.objects.get(number="212").pk)
    cms.post(f"/api/cms/rooms/{room_id}/checkout")  # прежний гость выехал

    guest = guest_for(client, crystal, room="212")
    done = _finished_order(client, crystal, guest, key="card-done")
    guest.post(f"/api/guest/order/{done}/review", {"rating": 1, "comment": "холодно"})
    menu = guest.get("/api/guest/catalog?type=product").json()
    caesar = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    live = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": caesar, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="card-live",
    ).json()
    thread_id = guest.post("/api/guest/chat", {"body": "где заказ?"}).json()["thread_id"]

    card = desk(f"/api/tracker/chat/threads/{thread_id}/guest").json()
    assert card["room"] == "212" and card["reachable"] is True
    assert [o["number"] for o in card["active_orders"]] == [live["number"]]
    assert card["active_orders"][0]["status"]["title"]
    assert card["history_total"] == 1, "заказ прежнего гостя номера не в этом проживании"
    assert card["had_low_review"] is True and card["low_reviews"][0]["comment"] == "холодно"


def test_the_card_is_for_reception_only(client, crystal):
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "?"}).json()["thread_id"]
    assert staff_call(client, crystal, "chef")(f"/api/tracker/chat/threads/{thread_id}/guest").status_code == 403


# --- Кто отвечает ------------------------------------------------------------------------


@pytest.fixture
def thread_id(client, crystal):
    guest = guest_for(client, crystal, room="212")
    return guest.post("/api/guest/chat", {"body": "нужна помощь"}).json()["thread_id"]


def _holder(call, thread_id):
    row = next(r for r in _rows(call) if r["thread_id"] == thread_id)
    return row["holder"]


def test_opening_takes_and_the_colleague_sees_it(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    darya = staff_call(client, crystal, "manager.reception")

    opened = igor(f"/api/tracker/chat/threads/{thread_id}?hold=1").json()
    assert opened["holder"]["is_me"] is True

    seen = darya(f"/api/tracker/chat/threads/{thread_id}?hold=1").json()
    assert seen["holder"]["is_me"] is False and seen["holder"]["name"], "занято — видно кем"
    assert _holder(darya, thread_id)["name"] == seen["holder"]["name"]

    # Вмешаться можно — держатель не меняется.
    replied = darya(f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "подключилась"}).json()
    assert replied["holder"]["is_me"] is False

    taken = darya(f"/api/tracker/chat/threads/{thread_id}/take", "post", {}).json()
    assert taken["holder"]["is_me"] is True, "«Взять себе» перехватывает"


def test_release_frees_only_ones_own(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    darya = staff_call(client, crystal, "manager.reception")
    igor(f"/api/tracker/chat/threads/{thread_id}?hold=1")

    assert darya(f"/api/tracker/chat/threads/{thread_id}/release", "post", {}).json()["holder"] is not None
    assert igor(f"/api/tracker/chat/threads/{thread_id}/release", "post", {}).json()["holder"] is None


def test_silence_frees_the_dialog(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    igor(f"/api/tracker/chat/threads/{thread_id}?hold=1")
    with tenant_context(crystal):
        ChatThread.objects.filter(pk=thread_id).update(holder_seen_at=timezone.now() - timedelta(minutes=16))
    assert _holder(igor, thread_id) is None, "15 минут без признаков жизни — свободен"


def test_logging_out_frees_the_dialog(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    darya = staff_call(client, crystal, "manager.reception")
    igor(f"/api/tracker/chat/threads/{thread_id}?hold=1")
    with tenant_context(crystal):
        thread = ChatThread.objects.get(pk=thread_id)
        StaffSession.objects.filter(user_id=thread.holder_id).update(revoked_at=timezone.now())
    assert _holder(darya, thread_id) is None, "вход закрыт — диалог свободен"


def test_replying_in_a_free_dialog_takes_it(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    replied = igor(f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "да"}).json()
    assert replied["holder"]["is_me"] is True


def test_the_guest_never_sees_the_holder(client, crystal, thread_id):
    igor = staff_call(client, crystal, "reception")
    igor(f"/api/tracker/chat/threads/{thread_id}?hold=1")
    guest_view = guest_for(client, crystal, room="212")  # новый гость — свой тред
    assert "holder" not in guest_view.get("/api/guest/chat").json()


# --- Меню -----------------------------------------------------------------------------


def test_the_desk_is_in_the_menu_of_those_who_chat(client, crystal):
    def items(login):
        body = staff_call(client, crystal, login)("/api/cms/navigation")
        if body.status_code != 200:
            return set()
        return {item["key"] for group in body.json()["groups"] for item in group["items"]}

    assert "desk" in items("owner")
    assert "desk" in items("manager.reception")
    assert "desk" not in items("manager.restaurant")
