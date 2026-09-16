"""
Низкая оценка — руководителю отдела, а не во все его каналы.

Уровень адресата принимался и нигде не использовался: оценка «1 из 5» с
комментарием гостя уходила в общий чат кухни, где её читает вся смена.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.notifications.models import ChannelType, NotificationChannel

pytestmark = pytest.mark.django_db


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        return ExecutionPoint.objects.get(code="kitchen")


def _person(crystal, kitchen, email: str, level: str) -> NotificationChannel:
    with tenant_context(crystal):
        user = User.objects.create(email=email, full_name=email, hotel=crystal)
        StaffAssignment.objects.create(user=user, execution_point=kitchen, level=level)
        return NotificationChannel.objects.create(
            type=ChannelType.LOG, title=f"личный {email}", user=user
        )


def test_low_review_reaches_only_the_managers_personal_channel(crystal, kitchen):
    from apps.notifications.services.events import channels_for_audience

    manager = _person(crystal, kitchen, "boss@kitchen.test", StaffAssignment.Level.MANAGER)
    member = _person(crystal, kitchen, "cook@kitchen.test", StaffAssignment.Level.MEMBER)

    with tenant_context(crystal):
        point_channels = set(
            NotificationChannel.objects.filter(execution_point=kitchen).values_list("pk", flat=True)
        )
        assert point_channels, "у кухни в сиде есть общий канал — иначе проверять нечего"

        chosen = {channel.pk for channel in channels_for_audience("manager", kitchen.pk)}

    assert manager.pk in chosen
    assert member.pk not in chosen, "исполнитель не руководитель"
    assert not (chosen & point_channels), "общий чат отдела не получает оценку для руководителя"


def test_without_a_level_the_whole_point_is_addressed(crystal, kitchen):
    """Сообщение гостя в чат по-прежнему уходит в каналы отдела."""
    from apps.notifications.services.events import channels_for_audience

    with tenant_context(crystal):
        point_channels = set(
            NotificationChannel.objects.filter(execution_point=kitchen, is_active=True)
            .values_list("pk", flat=True)
        )
        chosen = {channel.pk for channel in channels_for_audience("point", kitchen.pk)}
    assert chosen == point_channels


def test_the_subscriber_itself_sends_only_to_the_manager(crystal, kitchen, monkeypatch, deliver_inline):
    """
    Проверка через сам обработчик события, а не через вспомогательную функцию:
    дефект жил именно в нём. Каналу руководителя дана метка в настройках, и
    записывается, в какие настройки реально ушла отправка.
    """
    from apps.events.bus import REVIEW_LOW, Event
    from apps.events.subscribers import chat_reviews
    from apps.notifications.channels import adapters

    manager = _person(crystal, kitchen, "boss2@kitchen.test", StaffAssignment.Level.MANAGER)
    with tenant_context(crystal):
        NotificationChannel.objects.filter(pk=manager.pk).update(config={"marker": "manager"})
        NotificationChannel.objects.filter(execution_point=kitchen).update(config={"marker": "point"})

    sent: list[dict] = []

    class Recorder:
        def send(self, message, config):
            sent.append(dict(config))
            return "recorded"

    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: Recorder())

    chat_reviews.notify_manager_of_low_rating(
        Event(
            name=REVIEW_LOW,
            hotel_id=str(crystal.pk),
            payload={
                "execution_point_id": str(kitchen.pk),
                "rating": 1,
                "number": 42,
                "comment": "холодно",
            },
        )
    )

    markers = [config.get("marker") for config in sent]
    assert "manager" in markers
    assert "point" not in markers, "оценка ушла в общий чат отдела"
