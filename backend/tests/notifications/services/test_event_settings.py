"""
Настройки событий: отель решает, слать ли, кому, чем и каким текстом.

И превью «вот так придёт» — на последнем НАСТОЯЩЕМ случае из данных отеля.
Выдуманный пример неотличим от настоящего (урок превью оформления из партии 7),
поэтому нет случая — нет и примера.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import ExecutionPoint
from apps.notifications.channels import adapters
from apps.notifications.models import (
    ChannelType,
    EventRecord,
    EventSetting,
    NotificationChannel,
)
from apps.notifications.services.events import notify
from tests.notifications.conftest import enable

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("deliver_inline")]

SETTINGS = "/api/cms/notification-events/settings"


class Recorder:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, message, config):
        self.sent.append((config.get("marker", ""), message.subject, message.body))
        return "ok"


@pytest.fixture
def recorder(monkeypatch):
    recording = Recorder()
    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: recording)
    return recording


@pytest.fixture
def kitchen(crystal):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="kitchen")
        NotificationChannel.objects.filter(execution_point=point).update(config={"marker": "point"})
        return point


def _manager(crystal, kitchen, email, *, language="ru", channel_type=ChannelType.LOG, marker=""):
    with tenant_context(crystal):
        user = User.objects.create(email=email, full_name=email, hotel=crystal, language=language)
        StaffAssignment.objects.create(
            user=user, execution_point=kitchen, level=StaffAssignment.Level.MANAGER
        )
        return NotificationChannel.objects.create(
            type=channel_type, title=f"личный {email}", user=user,
            config={"marker": marker or email, "to": [email]},
        )


# --- По умолчанию -----------------------------------------------------------


def test_optional_event_is_off_until_the_hotel_turns_it_on(crystal, kitchen, recorder):
    """Сообщение гостя в чат — не требует действия и по умолчанию не шлётся и не пишется."""
    with tenant_context(crystal):
        assert notify("chat.guest_message", {"preview": "?"}, point_id=kitchen.pk) is None
        assert not EventRecord.objects.filter(code="chat.guest_message").exists()
    assert recorder.sent == []

    enable(crystal, "chat.guest_message")
    with tenant_context(crystal):
        assert notify("chat.guest_message", {"preview": "?"}, point_id=kitchen.pk) is not None
    assert [marker for marker, *_ in recorder.sent] == ["point"]


def test_actionable_event_can_be_switched_off(crystal, kitchen, recorder, cms):
    _manager(crystal, kitchen, "boss@off.test")
    response = cms.put(f"{SETTINGS}/review.low", {"enabled": False})
    assert response.status_code == 200, response.content
    assert response.json()["enabled"] is False

    with tenant_context(crystal):
        assert notify("review.low", {"rating": 1, "number": 1}, point_id=kitchen.pk) is None
    assert recorder.sent == []


# --- Кому и чем -------------------------------------------------------------


def test_audience_can_be_moved_to_the_shared_channels(crystal, kitchen, recorder, cms):
    _manager(crystal, kitchen, "boss@moved.test", marker="manager")
    with tenant_context(crystal):
        NotificationChannel.objects.filter(title="Общий канал отеля").update(config={"marker": "shared"})

    assert cms.put(f"{SETTINGS}/review.low", {"audience": "hotel"}).status_code == 200
    with tenant_context(crystal):
        notify("review.low", {"rating": 2, "number": 5}, point_id=kitchen.pk)
    assert [marker for marker, *_ in recorder.sent] == ["shared"]


def test_one_chosen_channel(crystal, kitchen, recorder, cms):
    with tenant_context(crystal):
        chosen = NotificationChannel.objects.create(
            type=ChannelType.LOG, title="дежурный", config={"marker": "duty"}
        )
    response = cms.put(
        f"{SETTINGS}/order.cancelled", {"audience": "channel", "channel_id": str(chosen.pk)}
    )
    assert response.status_code == 200, response.content
    with tenant_context(crystal):
        notify("order.cancelled", {"number": 1}, point_id=kitchen.pk)
    assert [marker for marker, *_ in recorder.sent] == ["duty"]


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"audience": "channel"}, "channel_required"),
        ({"audience": "channel", "channel_id": "not-a-uuid"}, "channel_not_found"),
        ({"audience": "everyone"}, "invalid_audience"),
        ({"channel_types": ["pigeon"]}, "invalid_channel_type"),
    ],
)
def test_addressing_is_validated(cms, payload, code):
    response = cms.put(f"{SETTINGS}/order.cancelled", payload)
    assert response.status_code == 422, response.content
    assert code in response.content.decode()


def test_channel_types_narrow_the_audience(crystal, kitchen, recorder, cms):
    """Руководитель с почтой и мессенджером — отмены только в выбранный вид."""
    _manager(crystal, kitchen, "mail@types.test", channel_type=ChannelType.EMAIL, marker="email")
    _manager(crystal, kitchen, "log@types.test", marker="log")

    assert cms.put(f"{SETTINGS}/review.low", {"channel_types": ["email"]}).status_code == 200
    with tenant_context(crystal):
        notify("review.low", {"rating": 1, "number": 2}, point_id=kitchen.pk)
    assert [marker for marker, *_ in recorder.sent] == ["email"]


def test_overdue_recipients_belong_to_the_escalation_rules(cms):
    """Две настройки одного и того же — вопрос «какая главнее» без ответа."""
    response = cms.put(f"{SETTINGS}/order.overdue", {"audience": "hotel"})
    assert response.status_code == 422
    assert "audience_from_rules" in response.content.decode()
    assert cms.put(f"{SETTINGS}/order.overdue", {"enabled": False}).status_code == 200


# --- Текст -----------------------------------------------------------------


def test_hotel_text_is_used_in_its_language_only(crystal, kitchen, recorder, cms):
    _manager(crystal, kitchen, "en@text.test", language="en", marker="en")
    _manager(crystal, kitchen, "ru@text.test", language="ru", marker="ru")
    response = cms.put(
        f"{SETTINGS}/review.low",
        {"templates": {"ru": {"subject": "Гость недоволен: {{rating}} из 5", "body": "{{comment}}"}}},
    )
    assert response.status_code == 200, response.content

    with tenant_context(crystal):
        notify("review.low", {"rating": 2, "number": 9, "comment": ""}, point_id=kitchen.pk)
    by_marker = {marker: (subject, body) for marker, subject, body in recorder.sent}
    assert by_marker["ru"] == ("Гость недоволен: 2 из 5", "Без комментария")
    assert by_marker["en"][0] == "Low rating (2/5) · request #9"


@pytest.mark.parametrize(
    ("templates", "code"),
    [
        ({"ru": {"subject": "№{{numbr}}", "body": "x"}}, "unknown_placeholder"),
        ({"ru": {"subject": "только тема", "body": ""}}, "template_incomplete"),
        ({"fr": {"subject": "a", "body": "b"}}, "invalid_language"),
        ({"ru": {"subject": "a" * 256, "body": "b"}}, "too_long"),
    ],
)
def test_hotel_text_is_validated_on_save(cms, templates, code):
    """Опечатку в подстановке отель видит на экране, а не в «Заявка №—» у старшего."""
    response = cms.put(f"{SETTINGS}/review.low", {"templates": templates})
    assert response.status_code == 422, response.content
    assert code in response.content.decode()


def test_overdue_hotel_text_reaches_the_escalation(crystal, cms, deliver_inline, recorder):
    """Текст события эскалация берёт, если у канала нет своего шаблона."""
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    response = cms.put(
        f"{SETTINGS}/order.overdue",
        {"templates": {"ru": {"subject": "Никто не взял №{{number}}", "body": "{{point}}"}}},
    )
    assert response.status_code == 200, response.content

    from apps.notifications.models import NotificationLog
    from apps.notifications.services import execute_step, plan_escalation

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        NotificationChannel.objects.update(templates={})
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        subjects = set(NotificationLog.objects.filter(parent=parent).values_list("subject", flat=True))
    assert subjects == {f"Никто не взял №{order.number}"}


def test_switching_overdue_off_stops_planned_steps_too(crystal, cms):
    """Решение отеля действует сразу, а не со следующей заявки."""
    from apps.notifications.models import NotificationStatus
    from apps.notifications.services import execute_step, plan_escalation
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        planned = plan_escalation(order)
    assert cms.put(f"{SETTINGS}/order.overdue", {"enabled": False}).status_code == 200
    with tenant_context(crystal):
        step = execute_step(planned[1].pk)
        assert step.status == NotificationStatus.CANCELLED
        assert "выключил" in step.error
        assert plan_escalation(order) == []


# --- Экран и права -----------------------------------------------------------


def test_settings_list_every_event_with_its_default(cms):
    from apps.notifications import events as registry

    items = {item["code"]: item for item in cms.get(SETTINGS).json()["items"]}
    assert set(items) == set(registry.EVENTS)
    assert items["review.low"]["setting"]["enabled"] is True
    assert items["chat.guest_message"]["setting"]["enabled"] is False
    assert items["order.overdue"]["audience_from_rules"] is True
    assert items["review.low"]["defaults"]["en"]["subject"].startswith("Low rating")
    assert items["review.low"]["setting"]["customized"] is False


def test_a_change_is_written_to_the_audit_log(crystal, cms):
    """Кто выключил отмены — должно быть видно."""
    cms.put(f"{SETTINGS}/order.cancelled", {"enabled": False})
    with tenant_context(crystal):
        entry = AuditLog.objects.filter(action="notification.event_settings_changed").latest(
            "created_at"
        )
    assert entry.payload["code"] == "order.cancelled"
    assert entry.payload["changes"] == ["enabled"]


def test_returning_to_defaults_removes_the_hotel_row(crystal, cms):
    """«По умолчанию» — снова следовать справочнику, а не застывшая копия."""
    assert cms.put(f"{SETTINGS}/review.low", {"enabled": False}).json()["customized"] is True
    back = cms.put(
        f"{SETTINGS}/review.low",
        {"enabled": True, "audience": "manager", "channel_types": [], "templates": {}},
    ).json()
    assert back["customized"] is False
    assert back["enabled"] is True
    with tenant_context(crystal):
        assert not EventSetting.objects.filter(code="review.low").exists()


def test_a_manager_cannot_change_hotel_notifications(cms_manager, crystal):
    response = cms_manager.put(f"{SETTINGS}/order.cancelled", {"enabled": False})
    assert response.status_code == 403
    with tenant_context(crystal):
        assert not EventSetting.objects.filter(code="order.cancelled").exists()


def test_unknown_event_is_404(cms):
    assert cms.put(f"{SETTINGS}/nobody.knows", {"enabled": True}).status_code == 404


def test_settings_are_isolated_between_hotels(crystal, aurora, cms):
    cms.put(f"{SETTINGS}/order.cancelled", {"enabled": False})
    with tenant_context(aurora):
        assert not EventSetting.objects.filter(code="order.cancelled").exists()


# --- Превью ------------------------------------------------------------------


def _low_review(crystal, cms, rating=2, comment="Холодный суп"):
    from apps.reviews.models import Review
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        Review.objects.create(hotel=crystal, order=order, rating=rating, comment=comment)
    return order


def test_preview_uses_the_latest_real_case_and_sends_nothing(crystal, cms, recorder):
    from apps.hotels.models import ExecutionPoint

    order = _low_review(crystal, cms)
    with tenant_context(crystal):
        housekeeping = ExecutionPoint.objects.get(code="housekeeping")
    boss = _manager(crystal, housekeeping, "boss@preview.test", language="en")

    response = cms.post(
        f"{SETTINGS}/review.low/preview",
        {
            "language": "ru",
            "templates": {"ru": {"subject": "Черновик: {{rating}}/5 №{{number}}", "body": "{{comment}}"}},
        },
    )
    assert response.status_code == 200, response.content
    data = response.json()

    assert data["example"]["source"]["kind"] == "review"
    assert data["example"]["source"]["number"] == order.number
    assert data["example"]["source"]["rating"] == 2
    assert data["message"] == {
        "language": "ru",
        "subject": f"Черновик: 2/5 №{order.number}",
        "body": "Холодный суп",
    }
    # Получатель — каждый на своём языке, а русский черновик его не перебивает.
    mine = next(entry for entry in data["recipients"] if entry["channel_id"] == str(boss.pk))
    assert mine["language"] == "en"
    assert mine["subject"] == f"Low rating (2/5) · request #{order.number}"
    assert mine["recipient"] == "boss@preview.test"

    assert recorder.sent == [], "превью ничего не отправляет"
    with tenant_context(crystal):
        assert not EventSetting.objects.filter(code="review.low").exists(), "и ничего не сохраняет"
        assert not EventRecord.objects.filter(code="review.low").exists()


def test_preview_without_a_real_case_says_so_instead_of_inventing(crystal, cms):
    from apps.reviews.models import Review

    with tenant_context(crystal):
        Review.all_objects.all().delete()
    data = cms.post(f"{SETTINGS}/review.low/preview", {}).json()
    assert data["example"] is None
    assert data["message"] is None
    assert data["recipients"] is None


def test_preview_says_when_nobody_would_receive_it(crystal, cms):
    """Пример есть, адресатов нет — это и надо показать, а не пустую рамку."""
    _low_review(crystal, cms)
    with tenant_context(crystal):
        StaffAssignment.objects.filter(level=StaffAssignment.Level.MANAGER).delete()
    data = cms.post(f"{SETTINGS}/review.low/preview", {}).json()
    assert data["example"] is not None
    assert data["recipients"] == []


def test_preview_rejects_what_saving_would_reject(cms):
    response = cms.post(
        f"{SETTINGS}/review.low/preview",
        {"templates": {"ru": {"subject": "{{oops}}", "body": "x"}}},
    )
    assert response.status_code == 422
    assert "unknown_placeholder" in response.content.decode()


def test_overdue_preview_shows_every_step_of_the_rule(crystal, cms):
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    data = cms.post(f"{SETTINGS}/order.overdue/preview", {"language": "en"}).json()

    assert data["example"]["source"] == {
        "kind": "order",
        "number": order.number,
        "at": data["example"]["source"]["at"],
        "point": data["example"]["source"]["point"],
    }
    assert data["message"]["subject"].startswith(f"Request #{order.number}")
    assert data["rule"] is not None
    steps = {entry["step"]["delay_minutes"] for entry in data["recipients"]}
    assert 0 in steps, "первая ступень — сразу в отдел"
    assert len(steps) >= 2, "и подъём выше по правилу"


def test_cancellation_preview_uses_a_real_cancelled_order(crystal, cms, tracker):
    from tests.notifications.services.test_escalation import _place_housekeeping_request

    order = _place_housekeeping_request(cms.client, crystal)
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        change_status(
            get_order(order.pk), to_code="cancelled", actor_type="staff",
            cancel_reason="no_capacity", comment="все на выезде",
        )
    data = cms.post(f"{SETTINGS}/order.cancelled/preview", {"language": "en"}).json()
    assert data["example"]["source"]["kind"] == "cancelled_order"
    assert data["example"]["source"]["number"] == order.number
    assert "Reason: No one available to fulfil it" in data["message"]["body"]
    assert "все на выезде" in data["message"]["body"]


def test_a_manager_cannot_preview(cms_manager):
    assert cms_manager.post(f"{SETTINGS}/review.low/preview", {}).status_code == 403
