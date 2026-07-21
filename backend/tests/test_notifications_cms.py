"""CMS уведомлений: каналы, правила эскалации, журнал."""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.notifications.models import NotificationChannel

pytestmark = pytest.mark.django_db


# --- Каналы ----------------------------------------------------------------


def test_seeded_channels_are_listed(cms):
    titles = {channel["title"] for channel in cms.get("/api/cms/notification-channels").json()}
    assert {"Чат кухни", "Пётр — личный канал"} <= titles


def test_secret_is_written_but_never_returned(cms, crystal):
    """
    CMS открыта всем сотрудникам отеля. Токен бота можно записать, но нельзя
    прочитать — иначе обычный GET раздавал бы креды.
    """
    created = cms.post(
        "/api/cms/notification-channels",
        {
            "type": "telegram",
            "title": "Телеграм кухни",
            "config": {"bot_token": "123456:SUPERSECRET", "chat_id": "-100500"},
        },
    )
    assert created.status_code == 201, created.content
    body = created.json()

    assert "bot_token" not in str(body.get("config", ""))
    assert body["config_public"]["bot_token"] == "••••CRET"
    assert body["config_public"]["chat_id"] == "-100500"

    # В базе лежит настоящий токен — маскирование только на выдаче.
    with tenant_context(crystal):
        assert NotificationChannel.objects.get(pk=body["id"]).config["bot_token"] == (
            "123456:SUPERSECRET"
        )


def test_editing_a_channel_does_not_wipe_the_secret(cms, crystal):
    """
    Форма показывает токен маской. Если бы сохранение принимало её как новое
    значение, правка названия ломала бы интеграцию.
    """
    channel = cms.post(
        "/api/cms/notification-channels",
        {
            "type": "telegram",
            "title": "Бот",
            "config": {"bot_token": "123:SECRET", "chat_id": "-1"},
        },
    ).json()

    updated = cms.patch(
        f"/api/cms/notification-channels/{channel['id']}",
        {"title": "Бот кухни", "config": {"bot_token": "••••CRET", "chat_id": "-1"}},
    )
    assert updated.status_code == 200

    with tenant_context(crystal):
        assert NotificationChannel.objects.get(pk=channel["id"]).config["bot_token"] == "123:SECRET"


@pytest.mark.parametrize(
    "payload,field",
    [
        ({"type": "telegram", "title": "Б", "config": {"chat_id": "-1"}}, "config.bot_token"),
        ({"type": "telegram", "title": "Б", "config": {"bot_token": "x"}}, "config.chat_id"),
        ({"type": "email", "title": "П", "config": {}}, "config.to"),
        ({"type": "email", "title": "П", "config": {"to": ["не-адрес"]}}, "config.to"),
    ],
)
def test_channel_config_is_validated_per_type(cms, payload, field):
    response = cms.post("/api/cms/notification-channels", payload)
    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == "channel_config_invalid"
    assert body["field"] == field


def test_channel_type_cannot_be_changed(cms):
    channel = cms.post(
        "/api/cms/notification-channels", {"type": "log", "title": "Лог"}
    ).json()
    response = cms.patch(
        f"/api/cms/notification-channels/{channel['id']}", {"type": "telegram"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "type_immutable"


def test_test_message_reports_result(cms, crystal):
    """Настраивать канал вслепую и ждать первой заявки, чтобы узнать про опечатку, нельзя."""
    with tenant_context(crystal):
        channel_id = str(NotificationChannel.objects.get(title="Чат кухни").pk)

    response = cms.post(f"/api/cms/notification-channels/{channel_id}/test", {})
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_delete_channel(cms):
    channel = cms.post(
        "/api/cms/notification-channels", {"type": "log", "title": "Временный"}
    ).json()
    assert cms.delete(f"/api/cms/notification-channels/{channel['id']}").status_code == 200
    titles = {c["title"] for c in cms.get("/api/cms/notification-channels").json()}
    assert "Временный" not in titles


# --- Правила эскалации -----------------------------------------------------


def _point_id(cms, code: str) -> str:
    points = cms.get("/api/cms/bootstrap").json()["execution_points"]
    return next(point["id"] for point in points if point["code"] == code)


def test_seeded_rule_has_three_steps(cms):
    rules = cms.get("/api/cms/escalation-rules").json()
    kitchen = next(rule for rule in rules if rule["name"] == "Кухня: подъём по смене")

    assert [step["delay_minutes"] for step in kitchen["steps"]] == [0, 5, 15]
    assert [step["target_kind"] for step in kitchen["steps"]] == ["point", "lead", "manager"]


def test_create_rule_for_another_point(cms):
    response = cms.post(
        "/api/cms/escalation-rules",
        {
            "name": "Консьерж",
            "execution_point_id": _point_id(cms, "concierge"),
            "steps": [
                {"delay_minutes": 0, "target_kind": "point"},
                {"delay_minutes": 10, "target_kind": "manager"},
            ],
        },
    )
    assert response.status_code == 201, response.content
    assert [step["sort_order"] for step in response.json()["steps"]] == [0, 1]


@pytest.mark.parametrize(
    "steps,code",
    [
        ([], "rule_without_steps"),
        (
            [{"delay_minutes": 10, "target_kind": "point"}, {"delay_minutes": 5, "target_kind": "lead"}],
            "steps_out_of_order",
        ),
        (
            [{"delay_minutes": 5, "target_kind": "point"}, {"delay_minutes": 5, "target_kind": "lead"}],
            "duplicate_delay",
        ),
        ([{"delay_minutes": 0, "target_kind": "channel"}], "channel_required"),
    ],
)
def test_rule_validation(cms, steps, code):
    response = cms.post(
        "/api/cms/escalation-rules",
        {"name": "Проверка", "execution_point_id": _point_id(cms, "bar"), "steps": steps},
    )
    assert response.status_code == 422, response.content
    assert response.json()["code"] == code


def test_one_active_rule_per_point(cms):
    """Два активных правила на одну точку — это неопределённость, а не гибкость."""
    response = cms.post(
        "/api/cms/escalation-rules",
        {
            "name": "Кухня дубль",
            "execution_point_id": _point_id(cms, "kitchen"),
            "steps": [{"delay_minutes": 0, "target_kind": "point"}],
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "rule_already_exists"


def test_update_replaces_steps_wholesale(cms, crystal):
    rules = cms.get("/api/cms/escalation-rules").json()
    rule_id = next(rule["id"] for rule in rules if rule["name"] == "Кухня: подъём по смене")

    updated = cms.patch(
        f"/api/cms/escalation-rules/{rule_id}",
        {"steps": [{"delay_minutes": 0, "target_kind": "point", "title": "Сразу"}]},
    )
    assert updated.status_code == 200
    assert len(updated.json()["steps"]) == 1
    assert updated.json()["steps"][0]["title"] == "Сразу"


def test_delete_rule(cms):
    rules = cms.get("/api/cms/escalation-rules").json()
    rule_id = rules[0]["id"]
    assert cms.delete(f"/api/cms/escalation-rules/{rule_id}").status_code == 200
    assert rule_id not in {rule["id"] for rule in cms.get("/api/cms/escalation-rules").json()}


# --- Журнал ----------------------------------------------------------------


def test_log_shows_step_and_its_deliveries(client, crystal, cms, settings):
    """
    Записи двухуровневые: ступень сработала → ушло в такие-то каналы. Без этого
    в журнале было бы непонятно, почему одна ступень дала две строки.
    """
    settings.NOTIFICATIONS_ENABLED = True

    from apps.notifications.services import execute_step, plan_escalation
    from apps.orders.services import order_queryset

    from .conftest import host_for

    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    menu = client.get(
        "/api/guest/menu", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()
    item_id = next(
        entry["id"]
        for category in menu["categories"]
        for entry in category["items"]
        if entry["code"] == "caesar"
    )
    created = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="log-1",
    )
    order_id = created.json()["id"]

    with tenant_context(crystal):
        order = order_queryset().get(pk=order_id)
        planned = plan_escalation(order)
        execute_step(planned[0].pk)

    entries = cms.get(f"/api/cms/notification-log?order_id={order_id}").json()
    parents = [entry for entry in entries if entry["parent_id"] is None]
    children = [entry for entry in entries if entry["parent_id"]]

    assert len(parents) == 3, "по записи на каждую ступень"
    assert len(children) == 1, "первая ступень ушла в один канал"
    assert children[0]["channel_title"] == "Чат кухни"
    assert children[0]["step_index"] == 0

    scheduled = cms.get("/api/cms/notification-log?status=scheduled").json()
    assert all(entry["status"] == "scheduled" for entry in scheduled)


def test_channels_are_isolated_between_hotels(cms, cms_aurora):
    crystal_ids = {c["id"] for c in cms.get("/api/cms/notification-channels").json()}
    aurora_ids = {c["id"] for c in cms_aurora.get("/api/cms/notification-channels").json()}

    assert crystal_ids and aurora_ids
    assert crystal_ids.isdisjoint(aurora_ids)


def test_guest_cannot_reach_notification_settings(client, crystal, guest_token):
    from .conftest import host_for

    response = client.get(
        "/api/cms/notification-channels",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
