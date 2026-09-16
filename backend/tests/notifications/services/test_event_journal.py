"""
Журнал событий: факт первичен, доставка — поверх.

До журнала рассылка чата, отзывов и оформления не оставляла следов: отказ
канала уходил в лог приложения, «некому отправить» не оставлялось нигде.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.notifications.channels import adapters
from apps.notifications.channels.base import ChannelError
from apps.notifications.models import (
    ChannelType,
    EventDelivery,
    EventRecord,
    NotificationChannel,
    NotificationStatus,
)
from apps.notifications.services.events import notify
from tests.notifications.conftest import enable

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("deliver_inline")]


class Recorder:
    """Адаптер-заглушка: записывает, что и в какие настройки ушло."""

    def __init__(self, fail: dict | None = None):
        self.sent: list[tuple[str, str]] = []
        self.fail = fail or {}

    def send(self, message, config):
        marker = config.get("marker", "")
        if marker in self.fail:
            raise self.fail[marker]
        self.sent.append((marker, message.subject))
        return f"ok:{marker}"


@pytest.fixture
def recorder(monkeypatch):
    recording = Recorder()
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: recording)
    return recording


@pytest.fixture(autouse=True)
def optional_events_on(crystal):
    """Чат и оформление по умолчанию выключены — здесь проверяется журнал, не выбор."""
    enable(crystal, "chat.guest_message", "brand.published_on_schedule")


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="kitchen")
        NotificationChannel.objects.filter(execution_point=point).update(config={"marker": "point"})
        return point


def test_fact_is_written_even_when_nobody_can_be_reached(crystal, recorder):
    """
    «Никто не узнал» тоже должно быть видно. Отель без общего канала — ровно
    так событие оформления и уходило в пустоту.
    """
    with tenant_context(crystal):
        NotificationChannel.objects.filter(execution_point__isnull=True, user__isnull=True).delete()
        record = notify("brand.published_on_schedule", {"version": 4})

        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.NO_RECIPIENTS
        assert record.payload == {"version": 4}
        assert not record.deliveries.exists()
    assert recorder.sent == []


def test_each_channel_gets_a_delivery_with_a_snapshot(crystal, kitchen, recorder):
    with tenant_context(crystal):
        record = notify(
            "chat.guest_message", {"room_number": "305", "preview": "Можно полотенце?"},
            point_id=kitchen.pk,
        )
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.SENT

        deliveries = list(record.deliveries.all())
        assert deliveries, "у кухни есть канал"
        delivery = deliveries[0]
        assert delivery.status == NotificationStatus.SENT
        assert delivery.sent_at is not None
        assert delivery.channel_type == ChannelType.LOG
        assert delivery.channel_title
        assert delivery.subject == "Сообщение из номера 305"
        assert delivery.body == "Можно полотенце?"
        assert delivery.language == "ru"
    assert ("point", "Сообщение из номера 305") in recorder.sent


def test_failed_channel_is_recorded_and_does_not_stop_the_rest(crystal, kitchen, monkeypatch):
    with tenant_context(crystal):
        NotificationChannel.objects.create(
            type=ChannelType.LOG, title="второй чат кухни", execution_point=kitchen,
            config={"marker": "broken"},
        )
    recording = Recorder(fail={"broken": ChannelError("Telegram ответил 400", retryable=False)})
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: recording)

    with tenant_context(crystal):
        record = notify("chat.guest_message", {"preview": "?"}, point_id=kitchen.pk)
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.PARTIAL

        broken = EventDelivery.objects.get(record=record, channel_title="второй чат кухни")
        assert broken.status == NotificationStatus.FAILED
        assert "400" in broken.error
    assert any(marker == "point" for marker, _ in recording.sent), "исправный канал своё получил"


def test_unexpected_channel_error_does_not_reach_the_caller(crystal, kitchen, monkeypatch):
    recording = Recorder(fail={"point": RuntimeError("сеть")})
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: recording)

    with tenant_context(crystal):
        record = notify("chat.guest_message", {"preview": "?"}, point_id=kitchen.pk)
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.FAILED
        assert "RuntimeError" in record.deliveries.first().error


def test_repeated_event_is_written_and_sent_once(crystal, kitchen, recorder):
    with tenant_context(crystal):
        first = notify("chat.guest_message", {"preview": "1"}, point_id=kitchen.pk, dedupe_key="chat:x")
        second = notify("chat.guest_message", {"preview": "1"}, point_id=kitchen.pk, dedupe_key="chat:x")
        assert first is not None
        assert second is None
        assert EventRecord.objects.filter(dedupe_key="chat:x").count() == 1
    assert len([s for s in recorder.sent if s[0] == "point"]) == 1


def test_department_event_without_a_department_is_recorded_as_unaddressed(crystal, recorder):
    with tenant_context(crystal):
        record = notify("review.low", {"rating": 1, "number": 7})
        record.refresh_from_db()
        assert record.outcome == EventRecord.Outcome.NO_RECIPIENTS


def test_guest_message_goes_through_the_journal_end_to_end(crystal, kitchen, recorder):
    """Обработчик события шины пишет журнал; повтор того же события — нет."""
    from apps.events.bus import CHAT_MESSAGE, Event
    from apps.events.subscribers import chat_reviews

    event = Event(
        name=CHAT_MESSAGE,
        hotel_id=str(crystal.pk),
        payload={
            "author_type": "guest",
            "execution_point_id": str(kitchen.pk),
            "room": "201",
            "preview": "Где ужин?",
        },
    )
    chat_reviews.notify_staff_of_guest_message(event)
    chat_reviews.notify_staff_of_guest_message(event)

    with tenant_context(crystal):
        records = EventRecord.objects.filter(code="chat.guest_message", dedupe_key__endswith=event.id)
        assert records.count() == 1
        assert records.first().payload["preview"] == "Где ужин?"


def test_journal_is_isolated_between_hotels(crystal, aurora, kitchen, recorder):
    with tenant_context(crystal):
        notify("chat.guest_message", {"preview": "секрет"}, point_id=kitchen.pk)
    with tenant_context(aurora):
        assert not EventRecord.objects.filter(payload__preview="секрет").exists()


def test_journal_api_shows_events_and_hides_hotel_level_from_a_manager(
    crystal, kitchen, recorder, cms, cms_manager
):
    with tenant_context(crystal):
        notify("chat.guest_message", {"preview": "кухне"}, point_id=kitchen.pk)
        notify("brand.published_on_schedule", {"version": 9})

    admin_codes = {item["code"] for item in cms.get("/api/cms/notification-events").json()["items"]}
    assert {"chat.guest_message", "brand.published_on_schedule"} <= admin_codes

    manager_items = cms_manager.get("/api/cms/notification-events").json()["items"]
    assert "brand.published_on_schedule" not in {item["code"] for item in manager_items}


def test_catalog_lists_every_registered_event(cms):
    from apps.notifications import events as registry

    codes = {item["code"] for item in cms.get("/api/cms/notification-events/catalog").json()["items"]}
    assert codes == set(registry.EVENTS)
