"""
Молчащий чат: порог отеля, сигнал смене и подъём руководителю; часы ресепшена.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.chat.models import ChatThread
from apps.chat.services import unanswered
from apps.core.context import tenant_context
from apps.core.models import ScheduledJob
from apps.hotels.models import Hotel, Schedule, ScheduleInterval, Service
from apps.notifications.models import EventRecord
from tests.chat.api.test_chat_reviews import guest_for, staff_call

pytestmark = pytest.mark.django_db


@pytest.fixture
def waiting(client, crystal, settings):
    settings.NOTIFICATIONS_ENABLED = True
    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "нужен фен"}).json()["thread_id"]
    return guest, thread_id


def _run_due(crystal, thread_id, step=1, waiting_since=None):
    with tenant_context(crystal):
        thread = ChatThread.objects.get(pk=thread_id)
        job = ScheduledJob(
            kind=unanswered.JOB_KIND,
            payload={
                "thread_id": str(thread.pk),
                "step": step,
                "waiting_since": (waiting_since or thread.last_guest_message_at).isoformat(),
            },
        )
        return unanswered.run(job)


# --- Порог ---------------------------------------------------------------------


def test_the_threshold_is_a_hotel_setting(cms, crystal, client):
    assert cms.get("/api/cms/chat-settings").json()["reply_wait_minutes"] == 10
    saved = cms.patch("/api/cms/chat-settings", {"reply_wait_minutes": 3})
    assert saved.status_code == 200 and saved.json()["reply_wait_minutes"] == 3
    with tenant_context(crystal):
        assert Hotel.objects.get(pk=crystal.pk).chat_reply_minutes == 3

    guest = guest_for(client, crystal, room="212")
    thread_id = guest.post("/api/guest/chat", {"body": "ау"}).json()["thread_id"]
    with tenant_context(crystal):
        ChatThread.objects.filter(pk=thread_id).update(
            last_guest_message_at=timezone.now() - timedelta(minutes=4)
        )
    body = staff_call(client, crystal, "reception")("/api/tracker/chat/threads?limit=50").json()
    assert body["reply_wait_minutes"] == 3
    row = next(r for r in body["items"] if r["thread_id"] == thread_id)
    assert row["is_late"] is True, "порог отеля, а не зашитые десять минут"


def test_a_silly_threshold_is_refused(cms):
    assert cms.patch("/api/cms/chat-settings", {"reply_wait_minutes": 0}).status_code == 422
    assert cms.patch("/api/cms/chat-settings", {"reply_wait_minutes": 999}).json()["code"] == "bad_reply_wait"


def test_only_the_admin_changes_it(client, crystal):
    from tests.conftest import CmsClient, staff_token_for

    manager = CmsClient(client, crystal, staff_token_for(client, crystal, "manager.reception"))
    assert manager.patch("/api/cms/chat-settings", {"reply_wait_minutes": 20}).status_code == 403


# --- Сигнал --------------------------------------------------------------------


def test_a_guest_message_schedules_the_check(client, crystal, waiting):
    _, thread_id = waiting
    with tenant_context(crystal):
        jobs = ScheduledJob.objects.filter(kind=unanswered.JOB_KIND)
        assert jobs.count() == 1
        job = jobs.first()
        thread = ChatThread.objects.get(pk=thread_id)
        assert job.payload["thread_id"] == str(thread_id)
        assert job.run_at == thread.last_guest_message_at + timedelta(minutes=10)


def test_silence_signals_the_shift_then_the_manager(client, crystal, waiting):
    _, thread_id = waiting
    first = _run_due(crystal, thread_id, step=1)
    assert first["outcome"] == "notified" and first["step"] == 1
    with tenant_context(crystal):
        record = EventRecord.objects.get(code="chat.unanswered")
        assert record.execution_point.code == "reception"
        assert record.payload["room_number"] == "212"
        # Вторая ступень назначена сама: смена предупреждена, дальше — старший.
        assert ScheduledJob.objects.filter(kind=unanswered.JOB_KIND, payload__step=2).exists()

    second = _run_due(crystal, thread_id, step=2)
    assert second["outcome"] == "notified"
    with tenant_context(crystal):
        assert EventRecord.objects.filter(code="chat.unanswered_long").count() == 1


def test_an_answered_dialog_stays_quiet(client, crystal, waiting):
    _, thread_id = waiting
    staff_call(client, crystal, "reception")(f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "несём"})
    assert _run_due(crystal, thread_id)["outcome"] == "answered"
    with tenant_context(crystal):
        assert not EventRecord.objects.filter(code="chat.unanswered").exists()


def test_a_newer_message_supersedes_the_old_check(client, crystal, waiting):
    guest, thread_id = waiting
    with tenant_context(crystal):
        was = ChatThread.objects.get(pk=thread_id).last_guest_message_at
    guest.post("/api/guest/chat", {"body": "и ещё утюг"})
    assert _run_due(crystal, thread_id, waiting_since=was)["outcome"] == "superseded"


def test_the_signal_is_written_once_per_message(client, crystal, waiting):
    _, thread_id = waiting
    _run_due(crystal, thread_id)
    _run_due(crystal, thread_id)
    with tenant_context(crystal):
        assert EventRecord.objects.filter(code="chat.unanswered").count() == 1, "повтор — не второе событие"


# --- Часы ресепшена ----------------------------------------------------------------


def test_without_a_schedule_the_desk_promises_nothing(client, crystal):
    with tenant_context(crystal):
        # Отель без часов ресепшена: работает всегда — и обещаний не даём.
        Service.objects.filter(code="reception").update(schedule=None)
    guest = guest_for(client, crystal, room="212")
    body = guest.get("/api/guest/chat").json()
    assert "reply_hours" not in body or body["reply_hours"] is None


def test_with_a_schedule_the_guest_learns_when_the_desk_answers(client, crystal):
    with tenant_context(crystal):
        schedule = Schedule.objects.create(name="Ресепшен тест")
        for weekday in range(7):
            ScheduleInterval.objects.create(
                schedule=schedule, weekday=weekday, start_time="07:00", end_time="23:00"
            )
        Service.objects.filter(code="reception").update(schedule=schedule)
    guest = guest_for(client, crystal, room="212")
    hours = guest.get("/api/guest/chat").json()["reply_hours"]
    assert hours is not None and isinstance(hours["is_open"], bool)
    if not hours["is_open"]:
        assert hours["opens_at"], "закрыт — сказано, когда ответят"
