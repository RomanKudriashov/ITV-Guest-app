"""
Обвязка уведомлений.

Отправка идёт задачей Celery ПОСЛЕ КОММИТА. В тестах транзакция не
коммитится, поэтому `deliver_inline` исполняет отложенное сразу и зовёт тело
задачи вместо брокера — ровно ту функцию, что зовёт задача, с той же
развязкой «повторы исчерпаны → failed». Что отправка действительно ждёт
коммита, проверяется отдельным тестом без этой обвязки.
"""

from __future__ import annotations

import pytest
from django.db import transaction as django_transaction

from apps.core.context import tenant_context


class _CommitsAtOnce:
    """`transaction` модуля, у которого «после коммита» наступает сразу."""

    def __getattr__(self, name):
        return getattr(django_transaction, name)

    @staticmethod
    def on_commit(func, using=None, robust=False):
        func()


@pytest.fixture
def notifications_on(settings):
    settings.NOTIFICATIONS_ENABLED = True
    return settings


@pytest.fixture
def deliver_inline(monkeypatch, notifications_on):
    from apps.notifications import tasks
    from apps.notifications.channels.base import ChannelError
    from apps.notifications.services import delivery, events

    monkeypatch.setattr(events, "transaction", _CommitsAtOnce())
    monkeypatch.setattr(delivery, "transaction", _CommitsAtOnce())

    sent = {"events": [], "escalation": []}

    def run_event(delivery_id, hotel_id):
        sent["events"].append(delivery_id)
        with tenant_context(hotel_id):
            try:
                events.send_event_delivery(delivery_id)
            except ChannelError as exc:
                events.mark_event_delivery_failed(delivery_id, f"Канал недоступен: {exc.detail}")

    def run_escalation(log_id, hotel_id):
        sent["escalation"].append(log_id)
        with tenant_context(hotel_id):
            try:
                delivery.send_delivery(log_id)
            except ChannelError as exc:
                delivery.mark_delivery_failed(log_id, f"Канал недоступен: {exc.detail}")

    monkeypatch.setattr(tasks.deliver_event, "delay", run_event)
    monkeypatch.setattr(tasks.deliver_notification, "delay", run_escalation)
    return sent


def enable(hotel, *codes: str) -> None:
    """Включить события, выключенные по умолчанию (чат, оформление)."""
    from apps.notifications.models import EventSetting

    with tenant_context(hotel):
        for code in codes:
            EventSetting.objects.update_or_create(code=code, defaults={"is_enabled": True})
