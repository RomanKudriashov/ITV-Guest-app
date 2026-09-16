"""
Текст собирается на языке ПОЛУЧАТЕЛЯ, а не отеля.

Язык задан у 22 из 24 сотрудников стенда, но текст до сих пор шёл на языке
отеля всем подряд: англоязычный руководитель получал оценку гостя по-русски.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.notifications.channels import adapters
from apps.notifications.models import ChannelType, EventDelivery, NotificationChannel
from apps.notifications.services.events import notify, recipient_language

pytestmark = pytest.mark.django_db


class Quiet:
    def send(self, message, config):
        return "ok"


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: Quiet())


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        return ExecutionPoint.objects.get(code="kitchen")


def _manager(crystal, kitchen, email, language) -> NotificationChannel:
    with tenant_context(crystal):
        user = User.objects.create(email=email, hotel=crystal, language=language)
        StaffAssignment.objects.create(
            user=user, execution_point=kitchen, level=StaffAssignment.Level.MANAGER
        )
        return NotificationChannel.objects.create(
            type=ChannelType.LOG, title=f"личный {email}", user=user
        )


def test_personal_channel_speaks_the_owners_language(crystal, kitchen, notifications_on):
    english = _manager(crystal, kitchen, "en@kitchen.test", "en")
    russian = _manager(crystal, kitchen, "ru@kitchen.test", "ru")

    with tenant_context(crystal):
        record = notify("review.low", {"rating": 2, "number": 11, "comment": ""}, point_id=kitchen.pk)
        by_channel = {d.channel_id: d for d in EventDelivery.objects.filter(record=record)}

    assert by_channel[english.pk].language == "en"
    assert by_channel[english.pk].subject == "Low rating (2/5) · request #11"
    assert by_channel[english.pk].body == "No comment", "и готовое слово — на его языке"
    assert by_channel[russian.pk].language == "ru"
    assert by_channel[russian.pk].subject.startswith("Низкая оценка")


def test_shared_department_channel_uses_the_hotel_language(crystal, kitchen):
    with tenant_context(crystal):
        point_channel = NotificationChannel.objects.filter(execution_point=kitchen).first()
        assert recipient_language(point_channel, crystal) == crystal.default_language


@pytest.mark.parametrize(
    ("stored", "expected"),
    [("en-US", "en"), ("ZH", "zh"), ("", "ru"), ("fr", "ru")],
)
def test_language_is_normalised_and_unknown_falls_back_to_the_hotel(crystal, kitchen, stored, expected):
    """Отель «Кристалл» говорит по-русски — ему и достаётся то, чего нет в справочнике."""
    channel = _manager(crystal, kitchen, f"{stored or 'none'}@lang.test", stored)
    with tenant_context(crystal):
        channel = NotificationChannel.objects.select_related("user").get(pk=channel.pk)
        assert recipient_language(channel, crystal) == expected


# --- Эскалация ------------------------------------------------------------


def test_escalation_step_speaks_the_leads_language(client, crystal, deliver_inline):
    """
    Вторая ступень эскалации уходит старшему смены в личный канал — и на его
    языке: и слова справочника, и слово «Номер», и название отдела.
    """
    from apps.notifications.models import NotificationLog
    from apps.notifications.services import execute_step, plan_escalation
    from apps.orders.models import Order
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
        HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_IDEMPOTENCY_KEY="lang-1",
    )
    assert created.status_code == 201, created.content

    with tenant_context(crystal):
        lead_channel = NotificationChannel.objects.get(title="Пётр — личный канал")
        # У Петра в сиде шаблон ТОЛЬКО русский — и язык получателя его перебивает.
        User.objects.filter(pk=lead_channel.user_id).update(language="en")
        order = Order.objects.select_related("status", "execution_point").get(pk=created.json()["id"])
        planned = plan_escalation(order)
        parent = execute_step(planned[1].pk)
        delivery = NotificationLog.objects.get(parent=parent, channel=lead_channel)

    assert delivery.subject.startswith("Request #"), delivery.subject
    assert "Room 305" in delivery.body, delivery.body


def test_hotel_template_in_the_recipients_language_still_wins(crystal, kitchen):
    """Свой текст отеля на языке получателя важнее текста справочника."""
    from apps.notifications.services.delivery import render_message

    with tenant_context(crystal):
        channel = NotificationChannel.objects.create(
            type=ChannelType.LOG, title="свой текст",
            templates={"en": {"subject": "Hey, #{{number}}!", "body": "custom"}},
        )

        class FakeOrder:
            number = 5
            room_id = None
            comment = ""
            total = None
            currency = "RUB"
            field_values = []
            hotel = crystal
            execution_point = kitchen

            class items:
                @staticmethod
                def all():
                    return []

            class status:
                title = {"ru": "Новый", "en": "New"}

        message = render_message(channel, FakeOrder(), None, "en")
    assert message.subject == "Hey, #5!"
