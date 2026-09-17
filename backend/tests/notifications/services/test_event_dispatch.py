"""
Отправка: служба расписания решает «когда», Celery отправляет с повторами.

Проверяется то, ради чего это разделение: вызывающий не ждёт чужой API и не
держит свою транзакцию, отправка не уходит раньше коммита, исчерпанные повторы
не пропадают молча, а служба расписания с новым потребителем остаётся видимой.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.core.models import ScheduledJob
from apps.hotels.models import ExecutionPoint
from apps.notifications import tasks
from apps.notifications.channels import adapters
from apps.notifications.channels.base import ChannelError
from apps.notifications.models import (
    ChannelType,
    EventRecord,
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
)
from apps.notifications.services import events
from tests.notifications.conftest import enable

pytestmark = pytest.mark.django_db


class Recorder:
    def __init__(self, fail: dict | None = None):
        self.sent: list[tuple[str, str]] = []
        self.fail = fail or {}

    def send(self, message, config):
        marker = config.get("marker", "")
        if marker in self.fail:
            raise self.fail[marker]
        self.sent.append((marker, message.subject))
        return "ok"


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="kitchen")
        NotificationChannel.objects.filter(execution_point=point).update(config={"marker": "point"})
        NotificationChannel.objects.filter(title="Общий канал отеля").update(
            config={"marker": "shared"}
        )
        return point


def _use(monkeypatch, recorder):
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: recorder)
    return recorder


# --- После коммита -----------------------------------------------------------


def test_sending_waits_for_the_commit(
    crystal, kitchen, notifications_on, monkeypatch, django_capture_on_commit_callbacks
):
    """
    Воркер, получивший задачу раньше коммита, не нашёл бы доставку. И вызывающий
    — чат, служба расписания — не ждёт канала внутри своей транзакции.
    """
    queued = []
    monkeypatch.setattr(tasks.deliver_event, "delay", lambda *args: queued.append(args))
    recorder = _use(monkeypatch, Recorder())

    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        with tenant_context(crystal):
            record = events.notify("review.low", {"rating": 1, "number": 3}, point_id=kitchen.pk)
            record = events.notify("order.cancelled", {"number": 3}, point_id=kitchen.pk)

    assert queued == [], "до коммита в очередь не уходит ничего"
    assert recorder.sent == [], "и уж точно ничего не отправлено"
    with tenant_context(crystal):
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.PENDING
        assert set(record.deliveries.values_list("status", flat=True)) == {
            NotificationStatus.SCHEDULED
        }

        delivery_ids = {str(pk) for pk in record.deliveries.values_list("pk", flat=True)}

    for callback in callbacks:
        callback()
    assert delivery_ids <= {args[0] for args in queued}, "после коммита — все доставки в очереди"


# --- Повторы и их конец --------------------------------------------------------


def test_retryable_error_leaves_the_delivery_for_the_next_attempt(
    crystal, kitchen, notifications_on, monkeypatch
):
    _use(monkeypatch, Recorder(fail={"point": ChannelError("сеть моргнула", retryable=True)}))
    with tenant_context(crystal):
        record = events.notify("order.cancelled", {"number": 4}, point_id=kitchen.pk)
        delivery = record.deliveries.first()

        with pytest.raises(ChannelError):
            events.send_event_delivery(delivery.pk)
        delivery.refresh_from_db()
        assert delivery.status == NotificationStatus.SCHEDULED, "ещё не конец — будет повтор"
        assert delivery.attempts == 1
        assert "моргнула" in delivery.error


def test_exhausted_retries_fail_and_tell_the_hotel(crystal, kitchen, notifications_on, monkeypatch):
    """Последний повтор не прошёл — «не доставлено» уходит в общий канал отеля."""
    from tests.notifications.conftest import _CommitsAtOnce

    recorder = _use(
        monkeypatch, Recorder(fail={"point": ChannelError("сеть лежит", retryable=True)})
    )
    monkeypatch.setattr(events, "transaction", _CommitsAtOnce())
    monkeypatch.setattr(tasks.deliver_event, "delay", lambda *args: None)

    with tenant_context(crystal):
        record = events.notify("order.cancelled", {"number": 5}, point_id=kitchen.pk)
        delivery = record.deliveries.get()
        assert delivery.channel_title == "Уведомления: Кухня"

    monkeypatch.setattr(
        tasks.deliver_event,
        "delay",
        lambda delivery_id, hotel_id: tasks.deliver_event.apply(args=(delivery_id, hotel_id)),
    )
    # Синхронно Celery проходит все повторы подряд, без пауз.
    result = tasks.deliver_event.apply(args=(str(delivery.pk), str(crystal.pk)))
    assert result.get()["status"] == "failed"

    with tenant_context(crystal):
        delivery.refresh_from_db()
        record.refresh_from_db()
        assert delivery.attempts == tasks.DELIVERY_RETRIES + 1, "первая попытка и все повторы"
        assert delivery.status == NotificationStatus.FAILED
        assert "сеть лежит" in delivery.error
        assert record.outcome == EventRecord.Outcome.FAILED

        notice = EventRecord.objects.get(code="notification.undelivered")
        assert notice.payload["channel"] == delivery.channel_title
        assert notice.payload["event"]["ru"] == "Заявку отменили"
        assert notice.outcome == EventRecord.Outcome.SENT
    assert ("shared", "Не доставлено: Заявку отменили") in recorder.sent


def test_a_broken_shared_channel_does_not_report_about_itself(
    crystal, kitchen, deliver_inline, monkeypatch
):
    """Сообщение о сбое, упавшее в тот же сломанный канал, не порождает следующее."""
    enable(crystal, "brand.published_on_schedule")
    _use(monkeypatch, Recorder(fail={"shared": ChannelError("бот удалён", retryable=False)}))

    with tenant_context(crystal):
        events.notify("brand.published_on_schedule", {"version": 1})
        notices = EventRecord.objects.filter(code="notification.undelivered")
        # Сломан единственный общий канал: сообщать о сбое некому — и это
        # видно в журнале, а не превращается в бесконечную цепочку.
        assert notices.count() == 1
        assert notices.get().outcome == EventRecord.Outcome.NO_RECIPIENTS


def test_partial_outcome_is_settled_after_every_delivery(crystal, kitchen, deliver_inline, monkeypatch):
    with tenant_context(crystal):
        NotificationChannel.objects.create(
            type=ChannelType.LOG, title="второй чат", execution_point=kitchen,
            config={"marker": "broken"},
        )
    _use(monkeypatch, Recorder(fail={"broken": ChannelError("400", retryable=False)}))
    with tenant_context(crystal):
        record = events.notify("order.cancelled", {"number": 6}, point_id=kitchen.pk)
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.PARTIAL


def test_escalation_delivery_that_never_arrived_is_reported(
    crystal, cms, deliver_inline, monkeypatch
):
    from apps.notifications.services import execute_step, plan_escalation
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        NotificationChannel.objects.create(
            type=ChannelType.LOG, title="чат хозслужбы", config={"marker": "hk"},
            execution_point=ExecutionPoint.objects.get(code="housekeeping"),
        )
        NotificationChannel.objects.filter(title="Общий канал отеля").update(
            config={"marker": "shared"}
        )
    recorder = _use(monkeypatch, Recorder(fail={"hk": ChannelError("неверный токен", retryable=False)}))
    # Эскалация берёт адаптер своим импортом — подменяем сам лог-адаптер.
    monkeypatch.setattr(
        adapters.LogAdapter, "send", lambda self, message, config: recorder.send(message, config)
    )

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        failed = NotificationLog.objects.get(parent=parent, channel__title="чат хозслужбы")
        assert failed.status == NotificationStatus.FAILED

        notice = EventRecord.objects.get(code="notification.undelivered")
        assert notice.payload["event"]["ru"] == "Заявка ждёт ответа"
        assert notice.payload["channel"] == "чат хозслужбы"
        assert notice.dedupe_key == f"notification.undelivered:escalation:{failed.pk}"
    assert any(marker == "shared" for marker, _ in recorder.sent)


# --- Отмена заказа -------------------------------------------------------------


def test_guest_cancellation_reaches_the_department(
    client, crystal, deliver_inline, monkeypatch, django_capture_on_commit_callbacks
):
    from tests.conftest import host_for

    recorder = _use(monkeypatch, Recorder())
    token = client.post(
        "/api/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    ).json()["token"]
    menu = client.get(
        "/api/guest/catalog?type=product", HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()
    item_id = next(
        entry["id"] for category in menu["categories"] for entry in category["items"]
        if entry["code"] == "caesar"
    )
    created = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 2}], "timing": "asap"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_IDEMPOTENCY_KEY="cancel-notice",
    ).json()
    with tenant_context(crystal):
        kitchen = ExecutionPoint.objects.get(code="kitchen")
        NotificationChannel.objects.filter(execution_point=kitchen).update(config={"marker": "point"})

    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(
            f"/api/guest/order/{created['id']}/cancel", data={"reason": ""},
            content_type="application/json", HTTP_HOST=host_for(crystal),
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
    assert response.status_code == 200, response.content

    with tenant_context(crystal):
        record = EventRecord.objects.get(code="order.cancelled")
        assert str(record.execution_point_id) == str(kitchen.pk)
        delivery = record.deliveries.get(channel__execution_point=kitchen)
    assert delivery.subject.startswith(f"Заявка №{created['number']} отменена")
    assert "Номер 305" in delivery.body
    assert "2× Салат «Цезарь»" in delivery.body
    assert "Причина: Гость отказался" in delivery.body
    assert ("point", delivery.subject) in recorder.sent


def test_the_department_that_cancelled_is_not_told_about_it(
    client, crystal, tracker, deliver_inline, django_capture_on_commit_callbacks
):
    """Повар отменил со своей доски — сообщать ему же незачем."""
    from tests.conftest import host_for

    token = client.post(
        "/api/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    ).json()["token"]
    menu = client.get(
        "/api/guest/catalog?type=product", HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()
    item_id = next(
        entry["id"] for category in menu["categories"] for entry in category["items"]
        if entry["code"] == "caesar"
    )
    created = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_IDEMPOTENCY_KEY="cancel-by-chef",
    ).json()

    with django_capture_on_commit_callbacks(execute=True):
        response = tracker.post(
            f"/api/tracker/order/{created['id']}/cancel", {"cancel_reason": "out_of_stock"}
        )
    assert response.status_code == 200, response.content
    with tenant_context(crystal):
        assert not EventRecord.objects.filter(code="order.cancelled").exists()


def test_cancellation_by_someone_outside_the_department_is_sent(client, crystal, deliver_inline):
    """Отменила ресепшн или управляющий соседнего отдела — хозслужба должна узнать."""
    from apps.events.bus import ORDER_CANCELLED, Event
    from apps.events.subscribers import escalation
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(client, crystal)
    with tenant_context(crystal):
        outsider = User.objects.get(email="manager.restaurant@crystal.local")
        maid = User.objects.get(email="maid@crystal.local")

    def cancelled_by(user):
        escalation.notify_point_of_cancellation(
            Event(
                name=ORDER_CANCELLED,
                hotel_id=str(crystal.pk),
                payload={
                    "order_id": str(order.pk),
                    "execution_point_id": str(order.execution_point_id),
                },
                actor_type="staff",
                actor_id=user.pk,
            )
        )

    cancelled_by(maid)
    with tenant_context(crystal):
        assert not EventRecord.objects.filter(code="order.cancelled").exists(), "своя смена"
    cancelled_by(outsider)
    with tenant_context(crystal):
        assert EventRecord.objects.filter(code="order.cancelled").count() == 1


# --- Служба расписания ---------------------------------------------------------


def test_the_scheduler_runs_a_due_step_and_leaves_sending_to_celery(
    crystal, cms, notifications_on, monkeypatch, django_capture_on_commit_callbacks
):
    """
    Ступень через пять минут исполняет круг службы. Внутри круга — только
    запись доставок; в очередь они уходят после коммита, мимо блокировки.
    """
    from apps.core.services import scheduler
    from apps.notifications.services import plan_escalation
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    queued = []
    monkeypatch.setattr(tasks.deliver_notification, "delay", lambda *args: queued.append(args))

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        planned = plan_escalation(order)
        later = planned[1].scheduled_for + timedelta(seconds=30)

        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            assert scheduler.run_due_for_hotel(later) == 1
        assert queued == [], "в очередь — только после коммита круга"

        job = ScheduledJob.objects.get(payload__log_id=str(planned[1].pk))
        assert job.status == ScheduledJob.Status.DONE
        assert job.result["status"] == NotificationStatus.SENT

    for callback in callbacks:
        callback()
    assert queued, "после коммита доставки ушли в Celery"


def test_a_step_of_an_accepted_order_is_a_skipped_job(crystal, cms, notifications_on, monkeypatch):
    from apps.core.services import scheduler
    from apps.notifications.services import plan_escalation
    from apps.orders.services.tracker import accept_order
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        planned = plan_escalation(order)
        accept_order(User.objects.get(email="maid@crystal.local"), order.pk)
        scheduler.run_due_for_hotel(planned[1].scheduled_for + timedelta(seconds=1))
        job = ScheduledJob.objects.get(payload__log_id=str(planned[1].pk))
        assert job.status == ScheduledJob.Status.SKIPPED
        assert job.result["reason"] == NotificationStatus.CANCELLED


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_heartbeat_tells_kinds_apart(crystal, cms, notifications_on):
    """
    Сотня ступеней эскалации не должна заслонить одну просроченную публикацию:
    консоль показывает разбивку по видам и сколько ждёт впереди.
    """
    from apps.core.services import scheduler
    from apps.notifications.services import plan_escalation
    from apps.notifications.services.delivery import STEP_JOB_KIND
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        plan_escalation(order)
        # Публикация, пролежавшая полчаса: служба стояла. Круг её выполнит
        # (черновика нет — «не состоялась»), но просроченной она была.
        ScheduledJob.objects.create(
            hotel=crystal, kind="brand.publish", run_at=timezone.now() - timedelta(minutes=30),
            payload={"draft_id": "missing"},
        )

    summary = scheduler.tick(now=timezone.now())
    kinds = summary["by_kind"]
    assert kinds[STEP_JOB_KIND]["pending"] >= 1
    assert kinds["brand.publish"]["overdue"] >= 1
    assert summary["pending"] >= kinds[STEP_JOB_KIND]["pending"]

    from apps.hotels.models import Hotel
    from apps.hotels.services.platform.overview import _health

    health = _health(list(Hotel.objects.all()), timezone.localdate())
    signal = next(item for item in health if item["code"].startswith("scheduler_"))
    listed = {entry["kind"] for entry in signal["kinds"]}
    assert STEP_JOB_KIND in listed
