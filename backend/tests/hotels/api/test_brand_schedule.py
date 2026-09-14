"""
Публикация оформления по расписанию.

Три вещи проверяются по существу: время понимается как ВРЕМЯ ОТЕЛЯ, опоздание
называется вслух, а устаревший черновик ночью не публикуется молча — и остаётся
жив, чтобы утром оператор решил сам.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.models import AuditLog, ScheduledJob
from apps.core.services import scheduler
from apps.hotels.services import brand_schedule

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _draft(cms, name: str, primary: str) -> dict:
    response = cms.post(
        "/api/cms/brand/drafts",
        {"name": name, "tokens": {"palette": {"light": {"primary": primary}}}},
    )
    assert response.status_code == 200, response.content
    return response.json()


def _tomorrow_at(hotel, hour: int = 3) -> str:
    """Завтрашняя ночь ПО ЧАСАМ ОТЕЛЯ, строкой без пояса — как шлёт панель."""
    local = timezone.now().astimezone(hotel.tzinfo) + timedelta(days=1)
    return local.replace(hour=hour, minute=0, second=0, microsecond=0).strftime(
        "%Y-%m-%dT%H:%M"
    )


def _guest_primary(client, hotel) -> str:
    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    return response.json()["hotel"]["theme"]["palette"]["light"]["primary"].lower()


# --- Назначение -------------------------------------------------------------


def test_time_is_understood_as_the_hotels_own(cms, crystal):
    """
    «В три ночи» — это три ночи У ОТЕЛЯ.

    Прислать пояс мог бы браузер оператора, а оператор бывает в отпуске в другом
    поясе. Поэтому пояс подставляет сервер, и ровно отельный.
    """
    draft = _draft(cms, "Новый год", "#B00020")
    local = _tomorrow_at(crystal, hour=3)

    response = cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": local})
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["run_at_local"].startswith(local[:13]), "местное время разъехалось"
    assert body["timezone"] == str(crystal.tzinfo)

    # И в UTC лежит именно тот момент, который соответствует часам отеля.
    expected = timezone.make_aware(datetime.fromisoformat(local), crystal.tzinfo)
    assert datetime.fromisoformat(body["run_at"]) == expected


def test_a_time_already_past_is_refused(cms, crystal):
    draft = _draft(cms, "Опоздали", "#111111")
    past = (timezone.now().astimezone(crystal.tzinfo) - timedelta(hours=2)).strftime(
        "%Y-%m-%dT%H:%M"
    )

    response = cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": past})
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "run_at_in_past"


def test_scheduled_publication_is_visible_and_cancellable(cms, crystal):
    """
    Назначенное ВИДНО и отменяемо до срабатывания.

    Публикация, о которой знает только таблица, — сюрприз для утренней смены.
    """
    draft = _draft(cms, "Новый год", "#B00020")
    job = cms.post(
        f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)}
    ).json()

    listed = cms.get("/api/cms/brand/schedule").json()["scheduled"]
    assert [row["id"] for row in listed] == [job["id"]]
    assert listed[0]["draft_name"] == "Новый год"
    assert listed[0]["created_by"], "не видно, кто назначил"

    assert cms.delete(f"/api/cms/brand/schedule/{job['id']}").status_code == 200
    assert cms.get("/api/cms/brand/schedule").json()["scheduled"] == []


def test_rescheduling_replaces_the_previous_appointment(cms, crystal):
    """Одному черновику — одна назначенная публикация."""
    draft = _draft(cms, "Новый год", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal, 3)})
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal, 5)})

    listed = cms.get("/api/cms/brand/schedule").json()["scheduled"]
    assert len(listed) == 1, "витрина сменилась бы дважды непонятно в каком порядке"


# --- Срабатывание -----------------------------------------------------------


def test_the_publication_happens_and_reaches_the_guest(client, cms, crystal):
    draft = _draft(cms, "Новый год", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)})

    with tenant_context(crystal.id):
        job = ScheduledJob.objects.get(kind=brand_schedule.KIND)
        scheduler.run_due_for_hotel(job.run_at + timedelta(seconds=5))
        job.refresh_from_db()

    assert job.status == ScheduledJob.Status.DONE
    assert _guest_primary(client, crystal) == "#b00020"


def test_a_late_publication_is_marked_as_late(client, cms, crystal):
    """
    Опоздание называется вслух.

    Служба могла стоять, машина — перезагружаться. Публикация всё равно
    случается, но обещание было на конкретный час, и делать вид, что всё по
    плану, нельзя.
    """
    draft = _draft(cms, "Новый год", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)})

    with tenant_context(crystal.id):
        job = ScheduledJob.objects.get(kind=brand_schedule.KIND)
        scheduler.run_due_for_hotel(job.run_at + timedelta(hours=2))
        job.refresh_from_db()

        assert job.result["late"] is True
        assert job.delay_seconds >= 7000
        # Событие отдельное: «опубликовано» и «опубликовано с задержкой» — разные
        # новости для утренней смены.
        assert AuditLog.objects.filter(action="brand.published_late").exists()

    assert _guest_primary(client, crystal) == "#b00020"


def test_an_on_time_publication_raises_the_plain_event(cms, crystal):
    draft = _draft(cms, "Новый год", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)})

    with tenant_context(crystal.id):
        job = ScheduledJob.objects.get(kind=brand_schedule.KIND)
        scheduler.run_due_for_hotel(job.run_at + timedelta(seconds=5))

        assert AuditLog.objects.filter(action="brand.published_on_schedule").exists()
        assert not AuditLog.objects.filter(action="brand.published_late").exists()


# --- Устаревший черновик ночью ---------------------------------------------


def test_a_stale_draft_is_not_published_silently_and_survives(client, cms, crystal):
    """
    ГЛАВНАЯ ПРОВЕРКА ЭТОГО ЗАХОДА.

    Пока черновик ждал ночи, оформление изменил кто-то другой. Спросить оператора
    некому. Публикация стёрла бы чужую работу молча и без свидетелей — поэтому
    она не состоится, черновик останется жив, а утром об этом скажет событие.
    """
    draft = _draft(cms, "Новый год", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)})

    # Кто-то другой публикует своё, пока черновик ждёт.
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#333333"}}}})

    with tenant_context(crystal.id):
        job = ScheduledJob.objects.get(kind=brand_schedule.KIND)
        scheduler.run_due_for_hotel(job.run_at + timedelta(seconds=5))
        job.refresh_from_db()

    assert job.status == ScheduledJob.Status.SKIPPED, "«не состоялась» — исход, а не сбой"
    assert job.result["reason"] == "draft_stale"

    # Витрина осталась с чужой правкой — ничего не стёрто.
    assert _guest_primary(client, crystal) == "#333333"

    # Черновик ЖИВ: утром оператор решит сам.
    drafts = cms.get("/api/cms/brand/drafts").json()["drafts"]
    assert [row["name"] for row in drafts] == ["Новый год"]

    with tenant_context(crystal.id):
        event = AuditLog.objects.filter(action="brand.schedule_failed").first()
        assert event is not None, "ночью не состоялось, и никто не узнал"
        assert event.payload["reason"] == "draft_stale"


def test_a_deleted_draft_does_not_fail_the_service(cms, crystal):
    """Черновик убрали руками — задание честно не состоится, а не упадёт."""
    draft = _draft(cms, "Временный", "#B00020")
    cms.post(f"/api/cms/brand/drafts/{draft['id']}/schedule", {"run_at": _tomorrow_at(crystal)})
    cms.delete(f"/api/cms/brand/drafts/{draft['id']}")

    with tenant_context(crystal.id):
        job = ScheduledJob.objects.get(kind=brand_schedule.KIND)
        scheduler.run_due_for_hotel(job.run_at + timedelta(seconds=5))
        job.refresh_from_db()

    assert job.status == ScheduledJob.Status.SKIPPED
    assert job.result["reason"] == "draft_gone"


# --- Права ------------------------------------------------------------------


def test_a_guest_cannot_schedule_a_publication(client, crystal, guest_token):
    response = client.get(
        "/api/cms/brand/schedule",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
