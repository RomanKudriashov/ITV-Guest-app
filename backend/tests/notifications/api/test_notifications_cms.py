"""CMS уведомлений: каналы, правила эскалации, журнал."""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.notifications.models import NotificationChannel

pytestmark = pytest.mark.django_db


# --- Каналы ----------------------------------------------------------------


def test_seeded_channels_are_listed(cms):
    titles = {channel["title"] for channel in cms.get("/api/cms/notification-channels").json()["items"]}
    assert {"Уведомления: Кухня", "Пётр — личный канал"} <= titles


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
        channel_id = str(NotificationChannel.objects.get(title="Уведомления: Кухня").pk)

    response = cms.post(f"/api/cms/notification-channels/{channel_id}/test", {})
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_delete_channel(cms):
    channel = cms.post(
        "/api/cms/notification-channels", {"type": "log", "title": "Временный"}
    ).json()
    assert cms.delete(f"/api/cms/notification-channels/{channel['id']}").status_code == 200
    titles = {c["title"] for c in cms.get("/api/cms/notification-channels").json()["items"]}
    assert "Временный" not in titles


@pytest.mark.parametrize(
    "user_id",
    [
        pytest.param("00000000-0000-0000-0000-000000000009", id="несуществующий"),
        pytest.param("не-uuid", id="не-uuid"),
    ],
)
def test_personal_channel_rejects_unknown_user(cms, user_id):
    """
    Личный канал на чужого сотрудника — ошибка формы, а не пятисотка.

    Без проверки несуществующий id доезжал до INSERT (IntegrityError), а
    непригодный ломался ещё на разборе UUID: отель в обоих случаях видел 500 и
    не понимал, какое поле чинить.
    """
    response = cms.post(
        "/api/cms/notification-channels",
        {"type": "log", "title": "Личный", "user_id": user_id},
    )
    assert response.status_code == 422, response.content
    body = response.json()
    assert body["field"] == "user_id"
    assert body["detail"] == "Сотрудник не найден"


def test_personal_channel_accepts_a_real_user(cms):
    """Обратная сторона той же проверки: настоящий сотрудник проходит."""
    staff = cms.get("/api/cms/staff").json()["items"]
    assert staff, "демо-отель обязан иметь сотрудников"
    response = cms.post(
        "/api/cms/notification-channels",
        {"type": "log", "title": "Личный настоящий", "user_id": staff[0]["id"]},
    )
    assert response.status_code == 201, response.content
    assert response.json()["user_id"] == staff[0]["id"]


# --- Правила эскалации -----------------------------------------------------


def _point_id(cms, code: str) -> str:
    points = cms.get("/api/cms/bootstrap").json()["execution_points"]
    return next(point["id"] for point in points if point["code"] == code)


def test_seeded_rule_has_three_steps(cms):
    rules = cms.get("/api/cms/escalation-rules").json()["items"]
    kitchen = next(rule for rule in rules if rule["name"] == "Кухня: подъём по смене")

    assert [step["delay_minutes"] for step in kitchen["steps"]] == [0, 5, 15]
    assert [step["target_kind"] for step in kitchen["steps"]] == ["point", "lead", "manager"]


def test_create_rule_for_another_point(cms):
    # С R3 правило есть у КАЖДОГО заведения (подъём по его же SLA), поэтому
    # «завести правило другому отделу» теперь означает заменить дефолтное:
    # второе активное правило на точку система не даёт по построению.
    concierge_id = _point_id(cms, "concierge")
    for rule in cms.get("/api/cms/escalation-rules").json()["items"]:
        if rule["execution_point_id"] == concierge_id:
            assert cms.delete(f"/api/cms/escalation-rules/{rule['id']}").status_code == 200

    response = cms.post(
        "/api/cms/escalation-rules",
        {
            "name": "Консьерж",
            "execution_point_id": concierge_id,
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
    rules = cms.get("/api/cms/escalation-rules").json()["items"]
    rule_id = next(rule["id"] for rule in rules if rule["name"] == "Кухня: подъём по смене")

    updated = cms.patch(
        f"/api/cms/escalation-rules/{rule_id}",
        {"steps": [{"delay_minutes": 0, "target_kind": "point", "title": "Сразу"}]},
    )
    assert updated.status_code == 200
    assert len(updated.json()["steps"]) == 1
    assert updated.json()["steps"][0]["title"] == "Сразу"


def test_delete_rule(cms):
    rules = cms.get("/api/cms/escalation-rules").json()["items"]
    rule_id = rules[0]["id"]
    assert cms.delete(f"/api/cms/escalation-rules/{rule_id}").status_code == 200
    assert rule_id not in {rule["id"] for rule in cms.get("/api/cms/escalation-rules").json()["items"]}



def test_rule_changes_land_in_the_audit_log_with_before_and_after(cms, crystal):
    """
    Правило эскалации — настройка, как остальные (партия 30, п.57): кто, когда,
    что было, что стало. Сохранение без изменений журнал не засоряет.
    """
    from apps.core.models import AuditLog

    def entries(action):
        with tenant_context(crystal):
            return list(AuditLog.objects.filter(action=action).order_by("created_at"))

    rules = cms.get("/api/cms/escalation-rules").json()["items"]
    rule = next(rule for rule in rules if rule["name"] == "Кухня: подъём по смене")
    url = f"/api/cms/escalation-rules/{rule['id']}"

    assert cms.patch(url, {"name": rule["name"]}).status_code == 200
    assert entries("notification.escalation_rule_changed") == [], "ничего не поменялось — записи нет"

    assert cms.patch(
        url, {"name": "Кухня: быстрее", "steps": [{"delay_minutes": 0, "target_kind": "point"}]}
    ).status_code == 200
    [changed] = entries("notification.escalation_rule_changed")
    assert changed.actor_type == "staff" and changed.actor_id is not None, "кто"
    assert changed.created_at is not None, "когда"
    before, after = changed.payload["before"], changed.payload["after"]
    assert before["name"] == "Кухня: подъём по смене" and after["name"] == "Кухня: быстрее"
    assert [step["delay_minutes"] for step in before["steps"]] == [0, 5, 15]
    assert [step["delay_minutes"] for step in after["steps"]] == [0]

    assert cms.delete(url).status_code == 200
    [deleted] = entries("notification.escalation_rule_deleted")
    assert deleted.payload["before"]["name"] == "Кухня: быстрее" and deleted.payload["after"] is None

    created = cms.post(
        "/api/cms/escalation-rules",
        {
            "name": "Кухня заново",
            "execution_point_id": rule["execution_point_id"],
            "steps": [{"delay_minutes": 0, "target_kind": "point"}],
        },
    )
    assert created.status_code == 201, created.content
    [made] = entries("notification.escalation_rule_created")
    assert made.payload["before"] is None and made.payload["after"]["name"] == "Кухня заново"



def test_channel_changes_land_in_the_audit_log_and_the_secret_stays_masked(cms, crystal):
    """Вопрос п.57 «кто и когда выключил» — про канал тоже. Токен в журнал не попадает."""
    import json as _json

    from apps.core.models import AuditLog

    channel = cms.post(
        "/api/cms/notification-channels",
        {"type": "telegram", "title": "Бот смены", "config": {"bot_token": "777:TOPSECRET", "chat_id": "-5"}},
    ).json()
    assert cms.patch(f"/api/cms/notification-channels/{channel['id']}", {"is_active": False}).status_code == 200
    assert cms.delete(f"/api/cms/notification-channels/{channel['id']}").status_code == 200

    with tenant_context(crystal):
        rows = list(AuditLog.objects.filter(object_id=channel["id"]).order_by("created_at"))
    assert [row.action for row in rows] == [
        "notification.channel_created",
        "notification.channel_changed",
        "notification.channel_deleted",
    ]
    changed = rows[1]
    assert changed.actor_type == "staff" and changed.actor_id is not None
    assert (changed.payload["before"]["is_active"], changed.payload["after"]["is_active"]) == (True, False)
    assert "TOPSECRET" not in _json.dumps([row.payload for row in rows], ensure_ascii=False)


# --- Журнал ----------------------------------------------------------------


def test_log_shows_step_and_its_deliveries(client, crystal, cms, settings):
    """
    Записи двухуровневые: ступень сработала → ушло в такие-то каналы. Без этого
    в журнале было бы непонятно, почему одна ступень дала две строки.
    """
    settings.NOTIFICATIONS_ENABLED = True

    from apps.notifications.services import execute_step, plan_escalation
    from apps.orders.services import order_queryset

    from tests.conftest import host_for

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

    entries = cms.get(f"/api/cms/notification-log?order_id={order_id}").json()["items"]
    parents = [entry for entry in entries if entry["parent_id"] is None]
    children = [entry for entry in entries if entry["parent_id"]]

    assert len(parents) == 3, "по записи на каждую ступень"
    assert len(children) == 1, "первая ступень ушла в один канал"
    assert children[0]["channel_title"] == "Уведомления: Кухня"
    assert children[0]["step_index"] == 0

    scheduled = cms.get("/api/cms/notification-log?status=scheduled").json()["items"]
    assert all(entry["status"] == "scheduled" for entry in scheduled)

    # --- Фильтр принимает ТО, ЧТО ВИДНО В ТАБЛИЦЕ ---------------------------
    #
    # Заказ показан номером («№90768»), поле подписано «Заказ». Номер, набранный
    # оттуда, уходил в UUID-поле и возвращался пятисоткой.
    number = entries[0]["order_number"]
    by_number = cms.get(f"/api/cms/notification-log?order_id={number}")
    assert by_number.status_code == 200, by_number.content
    assert {entry["id"] for entry in by_number.json()["items"]} == {
        entry["id"] for entry in entries
    }

    # «№» перед цифрами отель наберёт вместе с ними — это тот же заказ.
    with_sign = cms.get(f"/api/cms/notification-log?order_id=№{number}")
    assert with_sign.status_code == 200, with_sign.content
    assert with_sign.json()["total"] == by_number.json()["total"] == len(entries)

    # UUID продолжает работать — старые ссылки не ломаются.
    assert cms.get(f"/api/cms/notification-log?order_id={order_id}").json()["total"] == len(
        entries
    )

    # Непригодная строка — пусто, а не «показали весь журнал».
    junk = cms.get("/api/cms/notification-log?order_id=такого-нет")
    assert junk.status_code == 200, junk.content
    assert junk.json()["total"] == 0


def test_channels_are_isolated_between_hotels(cms, cms_aurora):
    crystal_ids = {c["id"] for c in cms.get("/api/cms/notification-channels").json()["items"]}
    aurora_ids = {c["id"] for c in cms_aurora.get("/api/cms/notification-channels").json()["items"]}

    assert crystal_ids and aurora_ids
    assert crystal_ids.isdisjoint(aurora_ids)


def test_guest_cannot_reach_notification_settings(client, crystal, guest_token):
    from tests.conftest import host_for

    response = client.get(
        "/api/cms/notification-channels",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401


# --- Журнал: все отправки, не только эскалация (партия 31, INV-06 QA) ---------


def test_log_shows_event_deliveries_next_to_escalation(
    client, crystal, cms, notifications_on, monkeypatch, django_capture_on_commit_callbacks
):
    """
    QA отменял заявку гостем и не находил отправки `order.cancelled` в журнале:
    события писались в свою таблицу, а журнал читал только эскалацию.
    """
    from apps.notifications import tasks
    from apps.orders.models import Order
    from tests.conftest import host_for

    monkeypatch.setattr(tasks.deliver_event, "delay", lambda *a, **k: None)
    monkeypatch.setattr(tasks.deliver_notification, "delay", lambda *a, **k: None)
    token = client.post(
        "/api/guest/session", data={"room_number": "305"}, content_type="application/json", HTTP_HOST=host_for(crystal)
    ).json()["token"]
    auth = {"HTTP_HOST": host_for(crystal), "HTTP_AUTHORIZATION": f"Bearer {token}"}
    menu = client.get("/api/guest/catalog?type=product", **auth).json()
    item_id = next(e["id"] for c in menu["categories"] for e in c["items"] if e["code"] == "caesar")
    with django_capture_on_commit_callbacks(execute=True):
        created = client.post(
            "/api/guest/order", data={"lines": [{"item_id": item_id, "quantity": 1}]},
            content_type="application/json", HTTP_IDEMPOTENCY_KEY="inv06", **auth,
        ).json()
    from apps.notifications.services import plan_escalation

    with tenant_context(crystal):
        plan_escalation(Order.objects.get(pk=created["id"]))
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(
            f"/api/guest/order/{created['id']}/cancel", data={}, content_type="application/json", **auth
        ).status_code == 200

    rows = cms.get(f"/api/cms/notification-log?order_id={created['number']}").json()["items"]
    kinds = {(row["kind"], row.get("event_code")) for row in rows}
    assert ("event", "order.cancelled") in kinds, rows
    event = next(row for row in rows if row.get("event_code") == "order.cancelled")
    assert event["order_number"] == created["number"] and event["channel_title"]
    assert any(row["kind"] == "escalation" for row in rows), "эскалация заказа в той же ленте"


# --- Пробная отправка почты говорит, куда ушло письмо (партия 31, INV-01 QA) ---


@pytest.mark.parametrize(
    "backend,host,port,expected",
    [
        ("django.core.mail.backends.smtp.EmailBackend", "mailpit", 1025, "test_mailbox"),
        ("django.core.mail.backends.smtp.EmailBackend", "localhost", 1025, "test_mailbox"),
        ("django.core.mail.backends.console.EmailBackend", "localhost", 25, "test_mailbox"),
        ("django.core.mail.backends.smtp.EmailBackend", "smtp.yandex.ru", 465, "provider"),
    ],
)
def test_email_sink_is_named_honestly(settings, backend, host, port, expected):
    from apps.notifications.services.delivery import _email_sink

    settings.EMAIL_BACKEND, settings.EMAIL_HOST, settings.EMAIL_PORT = backend, host, port
    assert _email_sink() == expected


def test_channel_test_send_reports_the_test_mailbox(cms, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    channel = cms.post(
        "/api/cms/notification-channels",
        {"type": "email", "title": "Почта смены", "config": {"to": ["shift@crystal.local"]}},
    ).json()
    result = cms.post(f"/api/cms/notification-channels/{channel['id']}/test", {}).json()
    assert result["ok"] is True and result["delivered_to"] == "test_mailbox"
