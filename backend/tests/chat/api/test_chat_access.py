"""
Чат гостей читают ресепшен и администратор — больше никто.

До волны 9 ручка тредов пускала любого, кто вошёл в трекер: повар и
горничная читали все переписки отеля со всеми сообщениями.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.chat.models import ChatThread
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from tests.chat.api.test_chat_reviews import guest_for, staff_call
from tests.conftest import staff_token_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def thread_id(client, crystal):
    guest = guest_for(client, crystal, room="212")
    return guest.post("/api/guest/chat", {"body": "секрет гостя"}).json()["thread_id"]


@pytest.mark.parametrize("login", ["chef", "maid", "concierge", "manager.restaurant"])
def test_everyone_but_reception_is_refused(client, crystal, thread_id, login):
    call = staff_call(client, crystal, login)
    for path, method in (
        ("/api/tracker/chat/threads", "get"),
        (f"/api/tracker/chat/threads/{thread_id}", "get"),
        (f"/api/tracker/chat/threads/{thread_id}", "post"),
        (f"/api/tracker/chat/threads/{thread_id}/read", "post"),
    ):
        response = call(path, method, {"body": "x"}) if method == "post" else call(path)
        assert response.status_code == 403, (login, path, response.content)
        assert response.json()["code"] == "chat_forbidden"


@pytest.mark.parametrize("login", ["reception", "manager.reception", "owner"])
def test_reception_and_the_admin_read(client, crystal, thread_id, login):
    body = staff_call(client, crystal, login)("/api/tracker/chat/threads").json()
    assert thread_id in {item["thread_id"] for item in body["items"]}


def test_me_says_who_may_chat(client, crystal):
    def me(login):
        return staff_call(client, crystal, login)("/api/staff/auth/me").json()["user"]["can_chat"]

    assert me("reception") is True and me("owner") is True
    assert me("chef") is False and me("concierge") is False


def test_the_reception_is_the_point_with_the_code_not_any_of_its_kind(crystal):
    """У консьержа тоже вид «ресепшен» — чат уходил ему."""
    from apps.chat.services.threads import reception_point

    with tenant_context(crystal):
        assert reception_point().code == "reception"
        ExecutionPoint.objects.filter(code="reception").update(code="front-desk")
        assert reception_point().code == "concierge", "запасной путь — первая точка вида по коду"


def test_the_list_pages_by_cursor_and_skips_empty_threads(client, crystal):
    with tenant_context(crystal):
        empty = ChatThread.objects.create(hotel=crystal)  # пустой — витрина завела
    written = []
    for index in range(5):
        guest = guest_for(client, crystal, room="212")
        written.append(guest.post("/api/guest/chat", {"body": f"вопрос {index}"}).json()["thread_id"])
    call = staff_call(client, crystal, "reception")

    seen, cursor, pages = [], None, 0
    while True:
        path = "/api/tracker/chat/threads?limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = call(path).json()
        seen += [item["thread_id"] for item in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert pages >= 3
    assert len(seen) == len(set(seen)), "страницы не повторяются"
    assert set(written) <= set(seen)
    assert str(empty.pk) not in seen, "пустой тред персоналу не показываем"
    assert body["unread_total"] >= 5, "значок — по всем диалогам, не по странице"
    first = call("/api/tracker/chat/threads?limit=1").json()["items"][0]
    assert first["thread_id"] == written[-1] and first["last_body"] == "вопрос 4", "свежие сверху"


def test_a_bad_cursor_is_a_422(client, crystal):
    assert staff_call(client, crystal, "reception")("/api/tracker/chat/threads?cursor=junk").status_code == 422


def test_the_staff_socket_is_closed_for_the_cook(client, crystal, thread_id):
    from apps.realtime.consumers import _load_staff_thread

    cook = staff_token_for(client, crystal, "chef")
    desk = staff_token_for(client, crystal, "reception")
    # Сама функция, без async-обёртки: обёртка закрывает соединение теста.
    load = _load_staff_thread.func
    user, snapshot = load(crystal, cook, thread_id, "ru")
    assert user is not None and snapshot is None
    _, snapshot = load(crystal, desk, thread_id, "ru")
    assert snapshot is not None


def test_a_new_member_of_the_reception_gets_in(client, crystal, thread_id):
    with tenant_context(crystal):
        user = User.objects.get(email="maid@crystal.local")
        StaffAssignment.objects.create(user=user, execution_point=ExecutionPoint.objects.get(code="reception"))
    assert staff_call(client, crystal, "maid")("/api/tracker/chat/threads").status_code == 200
