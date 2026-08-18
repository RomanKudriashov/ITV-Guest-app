"""
Движок эскалации: планирование, подъём по ступеням, остановка при принятии.

Тайминги здесь НЕ ждём: ступени вызываются напрямую. Проверяется логика, а не
часы — иначе тест «через 15 минут эскалируем» шёл бы пятнадцать минут и всё
равно ничего не доказывал бы про гонки.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.notifications.channels.base import ChannelError, RenderedMessage
from apps.notifications.models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
    TargetKind,
)
from apps.notifications.services import (
    cancel_pending,
    escalation_should_stop,
    execute_step,
    plan_escalation,
    render_message,
    send_delivery,
)
from apps.orders.models import Order

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


# --- Обвязка ---------------------------------------------------------------


@pytest.fixture
def notifications_on(settings):
    settings.NOTIFICATIONS_ENABLED = True
    return settings


@pytest.fixture
def no_dispatch(monkeypatch):
    """
    Перехватываем постановку задач: планирование проверяем отдельно от
    исполнения, а брокер в тестах дёргать незачем.
    """
    calls = {"steps": [], "deliveries": []}

    class FakeResult:
        id = "fake-task-id"

    from apps.notifications import tasks

    monkeypatch.setattr(
        tasks.run_escalation_step,
        "apply_async",
        lambda args=None, **kw: calls["steps"].append((args, kw)) or FakeResult(),
    )
    monkeypatch.setattr(
        tasks.deliver_notification,
        "delay",
        lambda *args, **kw: calls["deliveries"].append(args) or FakeResult(),
    )
    return calls


@pytest.fixture
def order(client, crystal):
    """Заказ еды на кухню — у неё в сиде есть канал и правило."""
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]

    menu = client.get(
        "/api/guest/catalog?type=product", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()
    item_id = next(
        entry["id"]
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "caesar"
    )
    response = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="escalation-1",
    )
    assert response.status_code == 201, response.content

    with tenant_context(crystal):
        return Order.objects.select_related("status", "execution_point").get(
            pk=response.json()["id"]
        )


def steps_of(crystal) -> list[EscalationStep]:
    with tenant_context(crystal):
        rule = EscalationRule.objects.get(name="Кухня: подъём по смене")
        return list(rule.steps.all().order_by("sort_order"))


# --- Планирование ----------------------------------------------------------


def test_plan_creates_a_record_per_step(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        planned = plan_escalation(order)

        assert len(planned) == 3
        assert [log.step_index for log in planned] == [0, 1, 2]
        assert all(log.status == NotificationStatus.SCHEDULED for log in planned)

        # Задержка отсчитывается ОТ СОЗДАНИЯ ЗАКАЗА: «через 15 минут» означает
        # ровно это, а не «через 15 после предыдущей ступени».
        delays = [(log.scheduled_for - order.created_at).total_seconds() / 60 for log in planned]
        assert delays == [0, 5, 15]

    assert len(no_dispatch["steps"]) == 3


def test_planning_twice_does_not_duplicate(crystal, order, notifications_on, no_dispatch):
    """Повтор задачи планирования — обычное дело для Celery."""
    with tenant_context(crystal):
        plan_escalation(order)
        plan_escalation(order)

        assert NotificationLog.objects.filter(order=order, channel__isnull=True).count() == 3


def test_no_rule_means_no_escalation(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        EscalationRule.objects.all().delete()
        assert plan_escalation(order) == []


def test_disabled_globally_plans_nothing(crystal, order, settings, no_dispatch):
    settings.NOTIFICATIONS_ENABLED = False
    with tenant_context(crystal):
        assert plan_escalation(order) == []


# --- Исполнение ступени ----------------------------------------------------


def test_step_sends_to_point_channels(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        planned = plan_escalation(order)
        result = execute_step(planned[0].pk)

        assert result.status == NotificationStatus.SENT
        deliveries = list(NotificationLog.objects.filter(parent=result))
        assert len(deliveries) == 1
        assert deliveries[0].channel.title == "Чат кухни"
        assert deliveries[0].status == NotificationStatus.SCHEDULED
        assert str(order.number) in deliveries[0].subject

    assert len(no_dispatch["deliveries"]) == 1


def test_step_without_targets_is_skipped_not_silent(crystal, order, notifications_on, no_dispatch):
    """
    Молчаливое «никому не ушло» — худший исход: никто не заметит, что отдел
    без канала. В журнале должен остаться след.
    """
    with tenant_context(crystal):
        NotificationChannel.objects.all().delete()
        planned = plan_escalation(order)
        result = execute_step(planned[0].pk)

        assert result.status == NotificationStatus.SKIPPED
        assert "каналов" in result.error


def test_lead_step_reaches_personal_channel(crystal, order, notifications_on, no_dispatch):
    """Вторая ступень поднимает заявку на старшего смены, а не в общий чат."""
    with tenant_context(crystal):
        planned = plan_escalation(order)
        result = execute_step(planned[1].pk)

        assert result.status == NotificationStatus.SENT
        titles = {log.channel.title for log in NotificationLog.objects.filter(parent=result)}
        assert titles == {"Пётр — личный канал"}


def test_step_is_idempotent(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        planned = plan_escalation(order)
        execute_step(planned[0].pk)
        execute_step(planned[0].pk)

        assert NotificationLog.objects.filter(parent_id=planned[0].pk).count() == 1
    assert len(no_dispatch["deliveries"]) == 1


# --- Остановка при принятии --------------------------------------------------


def test_accepted_order_stops_escalation_at_execution_time(
    crystal, order, tracker, notifications_on, no_dispatch, django_capture_on_commit_callbacks
):
    """
    ГЛАВНАЯ проверка: задача ступени могла уйти в исполнение ровно в ту
    секунду, когда официант нажал «Принять», и отзыв задачи опоздал бы.
    Поэтому ступень обязана перечитать заказ перед отправкой.

    Здесь мы намеренно НЕ вызываем cancel_pending — имитируем именно гонку.
    """
    with tenant_context(crystal):
        planned = plan_escalation(order)

    with django_capture_on_commit_callbacks(execute=True):
        accepted = tracker.post(f"/api/tracker/order/{order.pk}/accept", {})
    assert accepted.status_code == 200

    with tenant_context(crystal):
        # Запись всё ещё «scheduled» — как если бы отмена не сработала.
        NotificationLog.objects.filter(pk=planned[1].pk).update(
            status=NotificationStatus.SCHEDULED
        )
        result = execute_step(planned[1].pk)

        assert result.status == NotificationStatus.CANCELLED
        assert result.accepted_at_send is True
        assert NotificationLog.objects.filter(parent=result).count() == 0

    assert no_dispatch["deliveries"] == []


def test_cancel_pending_quenches_scheduled_steps(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        plan_escalation(order)
        cancelled = cancel_pending(order)

        assert cancelled == 3
        statuses = set(
            NotificationLog.objects.filter(order=order).values_list("status", flat=True)
        )
        assert statuses == {NotificationStatus.CANCELLED}


def test_accepting_through_the_tracker_cancels_the_rest(
    crystal, order, tracker, notifications_on, no_dispatch, django_capture_on_commit_callbacks
):
    """Событие order.accepted гасит ступени само, без ручного вызова."""
    with tenant_context(crystal):
        plan_escalation(order)

    with django_capture_on_commit_callbacks(execute=True):
        tracker.post(f"/api/tracker/order/{order.pk}/accept", {})

    with tenant_context(crystal):
        remaining = NotificationLog.objects.filter(
            order=order, status=NotificationStatus.SCHEDULED
        ).count()
        assert remaining == 0


@pytest.mark.parametrize("status_code", ["preparing", "done", "cancelled"])
def test_any_progress_stops_escalation(crystal, order, status_code, notifications_on):
    """
    Взяли в работу, доставили, отменили — во всех случаях подъём бессмыслен.
    Проверяем сам предикат: от него зависит и отмена, и реконсиляция.
    """
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        change_status(get_order(order.pk), to_code=status_code, actor_type="staff")
        assert escalation_should_stop(get_order(order.pk)) is True


def test_untouched_order_does_not_stop_escalation(crystal, order):
    with tenant_context(crystal):
        assert escalation_should_stop(order) is False


# --- Отправка --------------------------------------------------------------


def test_delivery_marks_sent(crystal, order, notifications_on, no_dispatch):
    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        delivery = NotificationLog.objects.get(parent=parent)

        result = send_delivery(delivery.pk)
        assert result.status == NotificationStatus.SENT
        assert result.sent_at is not None
        assert result.attempts == 1


def test_delivery_is_idempotent(crystal, order, notifications_on, no_dispatch, monkeypatch):
    sent = []
    from apps.notifications.channels import adapters

    monkeypatch.setattr(
        adapters.LogAdapter, "send", lambda self, message, config: sent.append(message) or "ok"
    )

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        delivery = NotificationLog.objects.get(parent=parent)

        send_delivery(delivery.pk)
        send_delivery(delivery.pk)

    assert len(sent) == 1, "повтор задачи не должен слать второе сообщение"


def test_retryable_channel_error_propagates(crystal, order, notifications_on, no_dispatch, monkeypatch):
    """Временная ошибка должна дойти до Celery, чтобы он повторил."""
    from apps.notifications.channels import adapters

    def boom(self, message, config):
        raise ChannelError("сеть моргнула", retryable=True)

    monkeypatch.setattr(adapters.LogAdapter, "send", boom)

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        delivery = NotificationLog.objects.get(parent=parent)

        with pytest.raises(ChannelError):
            send_delivery(delivery.pk)

        delivery.refresh_from_db()
        assert delivery.status == NotificationStatus.SCHEDULED
        assert "моргнула" in delivery.error


def test_permanent_channel_error_fails_immediately(
    crystal, order, notifications_on, no_dispatch, monkeypatch
):
    """
    Неверный токен повтором не исправишь: дёргать чужой API ещё пять раз —
    только оттягивать честное «failed» в журнале.
    """
    from apps.notifications.channels import adapters

    def boom(self, message, config):
        raise ChannelError("неверный токен", retryable=False)

    monkeypatch.setattr(adapters.LogAdapter, "send", boom)

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        delivery = NotificationLog.objects.get(parent=parent)

        result = send_delivery(delivery.pk)
        assert result.status == NotificationStatus.FAILED
        assert "токен" in result.error


def test_failed_channel_does_not_affect_the_order(
    crystal, order, tracker, notifications_on, no_dispatch, monkeypatch
):
    """Упавший Telegram не должен мешать кухне работать с заявкой."""
    from apps.notifications.channels import adapters

    monkeypatch.setattr(
        adapters.LogAdapter,
        "send",
        lambda self, message, config: (_ for _ in ()).throw(ChannelError("нет", retryable=False)),
    )

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        send_delivery(NotificationLog.objects.get(parent=parent).pk)

    board = tracker.get("/api/tracker/orders?point=kitchen").json()
    numbers = [entry["number"] for column in board["columns"] for entry in column["orders"]]
    assert order.number in numbers


# --- Шаблоны ---------------------------------------------------------------


def test_template_placeholders_are_filled(crystal, order, notifications_on):
    with tenant_context(crystal):
        channel = NotificationChannel.objects.get(title="Чат кухни")
        step = steps_of(crystal)[0]
        message = render_message(channel, order, step, "ru")

        assert f"№{order.number}" in message.subject
        assert "Кухня ресторана" in message.subject
        assert "Номер 305" in message.body
        assert "Цезарь" in message.body


def test_unknown_placeholder_is_left_alone_not_crashing(crystal, order, notifications_on):
    """Шаблон правит отель — опечатка не должна ронять отправку."""
    with tenant_context(crystal):
        channel = NotificationChannel.objects.get(title="Чат кухни")
        channel.templates = {"ru": {"subject": "{{number}} {{oops}}", "body": "{{summary}}"}}
        channel.save()

        message = render_message(channel, order, steps_of(crystal)[0], "ru")
        assert message.subject == f"{order.number} {{{{oops}}}}"


def test_service_request_fields_get_into_the_message(client, crystal, notifications_on, no_dispatch):
    """У заявки-услуги в сообщении должны быть ответы на поля, а не пустота."""
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    catalog = client.get(
        "/api/guest/catalog?type=service_request",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()
    taxi_id = next(
        entry["id"]
        for category in catalog["categories"]
        for entry in category["items"]
        if entry["code"] == "taxi"
    )
    created = client.post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": taxi_id, "quantity": 1}],
            "timing": "asap",
            "field_values": {"destination": "Аэропорт Пулково", "when": "18:30", "passengers": 2},
        },
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="escalation-taxi",
    )
    assert created.status_code == 201, created.content

    with tenant_context(crystal):
        taxi_order = Order.objects.select_related("status", "execution_point").get(
            pk=created.json()["id"]
        )
        channel = NotificationChannel.objects.get(title="Чат кухни")
        message = render_message(channel, taxi_order, None, "ru")
        assert "Аэропорт Пулково" in message.body


# --- Изоляция --------------------------------------------------------------


def test_channels_are_isolated_between_hotels(crystal, aurora, order, notifications_on, no_dispatch):
    """Заявка «Кристалла» не может уйти в канал Aurora."""
    with tenant_context(aurora):
        NotificationChannel.objects.create(
            title="Чужой канал", type=ChannelType.LOG, execution_point=None
        )

    with tenant_context(crystal):
        planned = plan_escalation(order)
        parent = execute_step(planned[0].pk)
        titles = {log.channel.title for log in NotificationLog.objects.filter(parent=parent)}
        assert "Чужой канал" not in titles


def test_log_is_scoped_to_the_hotel(crystal, aurora, order, cms_aurora, notifications_on, no_dispatch):
    with tenant_context(crystal):
        plan_escalation(order)

    assert cms_aurora.get("/api/cms/notification-log").json()["items"] == []


# --- Эскалация на уровне сервиса (R3) --------------------------------------


def test_overdue_task_reaches_the_manager_of_its_own_service(
    client, crystal, notifications_on, no_dispatch
):
    """
    Задача висит дольше нормы СВОЕГО заведения → поднимается его управляющему.

    Проверяем и адресность: заявка хозслужбы не должна тревожить управляющего
    рестораном. «Норма» у каждого заведения своя — это sla_minutes точки, а не
    общее число по отелю.
    """
    from apps.accounts.models import User
    from apps.hotels.models import ExecutionPoint
    from apps.notifications.models import NotificationStatus
    from apps.notifications.services import execute_step

    order = _place_housekeeping_request(client, crystal)

    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="housekeeping")
        planned = plan_escalation(order)

        # Две ступени: сразу в отдел, затем — по норме отдела — управляющему.
        assert [log.target_kind for log in planned] == [TargetKind.POINT, TargetKind.MANAGER]
        delays = [(log.scheduled_for - order.created_at).total_seconds() / 60 for log in planned]
        assert delays == [0, point.sla_minutes]

        # Ступень «дольше нормы» доходит до управляющего хозслужбой.
        manager_step = execute_step(planned[1].pk)
        assert manager_step.status == NotificationStatus.SENT, manager_step.error

        recipients = {
            delivery.channel.user_id for delivery in manager_step.deliveries.all()
        }
        housekeeping_manager = User.objects.get(email="manager.housekeeping@crystal.local")
        restaurant_manager = User.objects.get(email="manager.restaurant@crystal.local")

        assert housekeeping_manager.pk in recipients
        assert restaurant_manager.pk not in recipients, "чужого управляющего не трогаем"


def test_taken_task_stops_escalating_to_the_manager(
    client, crystal, notifications_on, no_dispatch
):
    """Горничная взяла заявку — поднимать некого и незачем."""
    from apps.notifications.models import NotificationStatus
    from apps.notifications.services import execute_step
    from apps.orders.services.tracker import accept_order
    from apps.accounts.models import User

    order = _place_housekeeping_request(client, crystal)

    with tenant_context(crystal):
        planned = plan_escalation(order)
        maid = User.objects.get(email="maid@crystal.local")
        accept_order(maid, order.pk)

        manager_step = execute_step(planned[1].pk)
        assert manager_step.status == NotificationStatus.CANCELLED
        assert manager_step.accepted_at_send is True


def _place_housekeeping_request(client, crystal) -> Order:
    """Заявка на уборку гостевым потоком — задача очереди хозслужбы."""
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    kwargs = {"HTTP_HOST": host_for(crystal), "HTTP_AUTHORIZATION": f"Bearer {token}"}

    catalog = client.get("/api/guest/catalog?type=service_request", **kwargs).json()
    cleaning = next(
        entry
        for category in catalog["categories"]
        for entry in category["items"]
        if entry["code"] == "cleaning"
    )
    response = client.post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": cleaning["id"], "quantity": 1}],
            "timing": "asap",
            "field_values": {"when": "14:00"},
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="esc-hk",
        **kwargs,
    )
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        return Order.objects.select_related("status", "execution_point").get(
            pk=response.json()["id"]
        )
