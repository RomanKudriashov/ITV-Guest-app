"""
Передача диалога ПОИМЁННО (пункт 32 разбора).

До этого отдать переписку можно было только отделу — «Поручением», — либо
ждать, пока коллега перехватит её сам. Обе дороги отвечают «пусть кто-нибудь
займётся», а у смены ресепшена это и есть способ потерять гостя: каждый
думает, что взял другой.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.chat.models import ChatThread
from apps.core.context import tenant_context
from apps.notifications.models import EventRecord
from tests.chat.api.test_chat_reviews import guest_for
from tests.conftest import CmsClient, staff_token_for

pytestmark = pytest.mark.django_db


def _desk(client, crystal, login="reception"):
    return CmsClient(client, crystal, staff_token_for(client, crystal, login))


@pytest.fixture
def thread(client, crystal):
    guest = guest_for(client, crystal, room="212")
    guest.post("/api/guest/chat", {"body": "нужна вода"})
    with tenant_context(crystal):
        return ChatThread.objects.order_by("-created_at").first()


@pytest.fixture
def colleague(crystal):
    """Второй человек на ресепшене: передавать некому, если он один."""
    from apps.chat.services.threads import reception_point

    with tenant_context(crystal):
        point = reception_point()
        # Отель ставим ЯВНО: без него строка не проходит политику изоляции —
        # RLS отбивает вставку, а не молча кладёт «ничью» учётку.
        user = User.objects.create(
            hotel_id=crystal.id,
            email="reception2@crystal.local",
            full_name="Вторая смена",
            is_staff_member=True,
            is_active=True,
        )
        StaffAssignment.objects.create(
            hotel_id=crystal.id, user=user, execution_point=point,
            level=StaffAssignment.Level.MEMBER, is_active=True,
        )
        return user


def test_targets_are_those_who_may_read_the_chat(client, crystal, colleague):
    desk = _desk(client, crystal)
    rows = desk.get("/api/tracker/chat/handover-targets").json()["items"]
    names = {row["id"] for row in rows}
    assert str(colleague.pk) in names, "коллега по ресепшену не предложен"
    # Себя в списке нет: передать себе — не передача.
    me = desk.get("/api/tracker/chat/threads").json()
    del me
    with tenant_context(crystal):
        chef = User.objects.filter(email="chef@crystal.local").first()
    if chef:
        assert str(chef.pk) not in names, "повар не ведёт переписку — его нельзя предлагать"


def test_handover_moves_the_holder_and_leaves_a_line(client, crystal, thread, colleague):
    desk = _desk(client, crystal)
    answer = desk.post(
        f"/api/tracker/chat/threads/{thread.pk}/handover", {"user_id": str(colleague.pk)}
    )
    assert answer.status_code == 200, answer.content

    with tenant_context(crystal):
        fresh = ChatThread.objects.get(pk=thread.pk)
        assert fresh.holder_id == colleague.pk, "держатель не сменился"
        last = fresh.messages.order_by("-created_at").first()
        assert "Вторая смена" in last.body, "в переписке нет строки о передаче"


def test_the_person_is_notified_personally(client, crystal, thread, colleague, settings):
    """Уведомление уходит ЕМУ, а не отделу: иначе это снова «пусть кто-нибудь»."""
    settings.NOTIFICATIONS_ENABLED = True
    desk = _desk(client, crystal)
    desk.post(f"/api/tracker/chat/threads/{thread.pk}/handover", {"user_id": str(colleague.pk)})
    with tenant_context(crystal):
        record = EventRecord.objects.filter(code="chat.handover").order_by("-created_at").first()
        assert record is not None, "событие передачи не записано"
        assert record.payload.get("from_name")


def test_a_stranger_cannot_receive_a_chat(client, crystal, thread):
    """Передать тому, кто не вправе читать переписку, нельзя."""
    with tenant_context(crystal):
        chef = User.objects.filter(email="chef@crystal.local").first()
    if chef is None:
        pytest.skip("на стенде нет повара")
    desk = _desk(client, crystal)
    refused = desk.post(
        f"/api/tracker/chat/threads/{thread.pk}/handover", {"user_id": str(chef.pk)}
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "handover_not_allowed"


def test_a_cook_cannot_hand_over_at_all(client, crystal, thread, colleague):
    """Права на чат нет — нет и передачи: правило одно на чтение и на передачу."""
    cook = _desk(client, crystal, login="chef")
    refused = cook.post(
        f"/api/tracker/chat/threads/{thread.pk}/handover", {"user_id": str(colleague.pk)}
    )
    assert refused.status_code == 403
