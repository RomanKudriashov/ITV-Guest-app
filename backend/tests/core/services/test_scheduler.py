"""
Планировщик: назначенные задания и служба проверки.

Проверяется механизм, а не публикация оформления (та — в своём наборе): срок,
блокировка от двойного исполнения, отмена, неизвестный вид, пульс. Это общая
машина, и следующему потребителю — отложенным уведомлениям, переводу пачкой —
достанется ровно она.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.models import ScheduledJob, SchedulerHeartbeat
from apps.core.services import scheduler

pytestmark = pytest.mark.django_db


@pytest.fixture
def in_hotel(crystal):
    """
    Контекст отеля на всё тело проверки.

    Таблица тенантная и под RLS: без контекста она честно отдаёт ноль строк, и
    проверка соврала бы про «задание не создалось». Оборачиваем явно — это же
    делает и служба, обходя отели по кругу.
    """
    from apps.core.context import tenant_context

    with tenant_context(crystal.id):
        yield crystal


@pytest.fixture
def toy_kind():
    """Игрушечный вид задания: механизм не должен знать о предметной области."""
    calls: list[str] = []

    def handler(job):
        calls.append(str(job.pk))
        return {"ok": True, "calls": len(calls)}

    scheduler.register("test.toy", handler)
    yield calls
    scheduler._HANDLERS.pop("test.toy", None)


def _schedule(in_seconds: int = 60, kind: str = "test.toy") -> ScheduledJob:
    return scheduler.schedule(
        kind=kind,
        run_at=timezone.now() + timedelta(seconds=in_seconds),
        payload={"note": "проверка"},
    )


def test_a_job_waits_for_its_time(in_hotel, toy_kind):
    """Срок не пришёл — задание не трогают."""
    job = _schedule(in_seconds=3600)

    assert scheduler.run_due_for_hotel(timezone.now()) == 0
    job.refresh_from_db()
    assert job.status == ScheduledJob.Status.PENDING
    assert toy_kind == []


def test_a_job_runs_when_the_time_comes(in_hotel, toy_kind):
    job = _schedule(in_seconds=60)

    done = scheduler.run_due_for_hotel(timezone.now() + timedelta(seconds=61))
    assert done == 1

    job.refresh_from_db()
    assert job.status == ScheduledJob.Status.DONE
    assert job.result["ok"] is True
    assert len(toy_kind) == 1


def test_a_job_runs_only_once(in_hotel, toy_kind):
    """
    Повторный круг НЕ повторяет работу.

    Служб может оказаться две — выкатили новую, старая ещё жива, — и обе увидят
    одно задание. Публикация дважды означала бы две версии витрины из одного
    решения человека.
    """
    _schedule(in_seconds=0)
    later = timezone.now() + timedelta(seconds=10)

    assert scheduler.run_due_for_hotel(later) == 1
    assert scheduler.run_due_for_hotel(later) == 0
    assert len(toy_kind) == 1


def test_lateness_is_recorded_not_hidden(in_hotel, toy_kind):
    """
    Опоздание — исход, а не ошибка, и оно названо числом.

    Служба могла стоять, машина — перезагружаться. Работа всё равно делается, но
    делать вид, что всё по плану, нельзя: обещание было на конкретный час.
    """
    job = _schedule(in_seconds=0)

    scheduler.run_due_for_hotel(timezone.now() + timedelta(minutes=30))

    job.refresh_from_db()
    assert job.status == ScheduledJob.Status.DONE
    assert job.delay_seconds >= 1790, "опоздание на полчаса не записано"


def test_cancelled_job_does_not_run(in_hotel, toy_kind):
    job = _schedule(in_seconds=60)
    scheduler.cancel(job.pk)

    assert scheduler.run_due_for_hotel(timezone.now() + timedelta(seconds=120)) == 0
    job.refresh_from_db()
    assert job.status == ScheduledJob.Status.CANCELLED
    assert toy_kind == []


def test_an_executed_job_cannot_be_cancelled(in_hotel, toy_kind):
    """
    Отменить уже сделанное нельзя.

    Витрина изменилась; «отмена» задним числом создала бы у оператора ложное
    ощущение, что он всё вернул, — а возвращают откатом, и это другое действие.
    """
    from apps.core.errors import ValidationError

    job = _schedule(in_seconds=0)
    scheduler.run_due_for_hotel(timezone.now() + timedelta(seconds=10))

    with pytest.raises(ValidationError):
        scheduler.cancel(job.pk)


def test_an_unknown_kind_cannot_be_scheduled(in_hotel):
    """Назначить работу, которую некому делать, — тихая потеря обещания."""
    from apps.core.errors import ValidationError

    with pytest.raises(ValidationError):
        _schedule(kind="test.nobody")


def test_a_job_whose_handler_disappeared_fails_loudly(in_hotel, toy_kind):
    """Вид исчез вместе с кодом — строка честно говорит почему."""
    job = _schedule(in_seconds=0)
    scheduler._HANDLERS.pop("test.toy")

    scheduler.run_due_for_hotel(timezone.now() + timedelta(seconds=10))

    job.refresh_from_db()
    assert job.status == ScheduledJob.Status.FAILED
    assert job.result["reason"] == "unknown_kind"
    scheduler.register("test.toy", lambda job: {})


def test_a_failing_handler_does_not_stop_the_round(in_hotel):
    """Сбой одного задания не уносит с собой остальные."""
    def boom(job):
        raise RuntimeError("обработчик сломался")

    scheduler.register("test.boom", boom)
    try:
        job = _schedule(in_seconds=0, kind="test.boom")
        scheduler.run_due_for_hotel(timezone.now() + timedelta(seconds=10))

        job.refresh_from_db()
        assert job.status == ScheduledJob.Status.FAILED
        assert "сломался" in job.result["detail"]
    finally:
        scheduler._HANDLERS.pop("test.boom", None)


# --- Пульс -----------------------------------------------------------------


def test_the_tick_writes_a_heartbeat_even_with_nothing_to_do(in_hotel, toy_kind):
    """
    «Просыпалась и работы не было» и «не просыпалась» — разные вещи.

    Различить их можно только по отметке времени, поэтому пульс пишется всегда.
    """
    scheduler.tick()

    state = scheduler.heartbeat_state()
    assert state["alive"] is True
    assert state["last_tick_at"]
    assert state["age_seconds"] is not None


def test_a_silent_service_is_visible_as_dead(in_hotel):
    """
    Молчащая служба и работающая выглядят одинаково — если не спрашивать.

    Спрашиваем: пульс старше трёх минут означает «стоит», и консоль обязана
    показать это, а не «когда-то просыпалась».
    """
    scheduler.tick()
    heartbeat = SchedulerHeartbeat.objects.first()
    heartbeat.last_tick_at = timezone.now() - timedelta(minutes=10)
    heartbeat.save(update_fields=["last_tick_at"])

    state = scheduler.heartbeat_state()
    assert state["alive"] is False
    assert state["age_seconds"] >= 600


def test_the_heartbeat_counts_waiting_and_overdue(in_hotel, toy_kind):
    _schedule(in_seconds=3600)
    overdue = _schedule(in_seconds=0)
    overdue.run_at = timezone.now() - timedelta(minutes=30)
    overdue.save(update_fields=["run_at"])

    summary = scheduler.tick()

    # Просроченное выполнено этим же кругом — значит, в сводке оно посчитано как
    # пришедшее и сделанное, а не потеряно.
    assert summary["done"] == 1
    assert summary["overdue"] >= 1


def test_jobs_of_another_hotel_are_invisible(crystal, aurora, toy_kind):
    """
    В задании лежит решение отеля о будущем виде витрины.

    Урок прошлого захода: таблица тенантная и под RLS с первого дня, а не после
    падения сторожа.
    """
    from apps.core.context import tenant_context

    with tenant_context(crystal.id):
        _schedule(in_seconds=60)

    with tenant_context(aurora.id):
        assert ScheduledJob.objects.count() == 0
    with tenant_context(crystal.id):
        assert ScheduledJob.objects.count() == 1

