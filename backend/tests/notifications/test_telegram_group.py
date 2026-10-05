"""
TELEGRAM-ГРУППА ЧЕРЕЗ БОТА ПЛАТФОРМЫ (партия 32, п.16 решения по QA).

Панель выдаёт код → в группе `/connect КОД` (или ссылка `?startgroup=`, тогда
Telegram сам шлёт `/start КОД`) → канал получает адрес группы. Бота удалили —
канал помечен, доставки не идут; удалили канал — бот прощается и выходит.
Всё — на эмуляторе Bot API, тем же путём, что тесты личной привязки.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import requests
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.notifications.models import NotificationChannel
from apps.notifications.services import send_test_message
from tests.notifications.test_telegram_bot import bot, tg, tg_server  # noqa: F401 — общий эмулятор

# Бот — платформенный процесс: пишет платформенным подключением и закрывает
# соединения между кругами, поэтому — настоящие транзакции, как у тестов бота.
pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

GROUP = -100777
GROUP_TITLE = "Кухня — смена"
CREATE = "/api/cms/notification-channels/telegram-group"


def say_in_group(tg, text, *, chat=GROUP, title=GROUP_TITLE):
    requests.post(
        f"{tg.base}/_emulator/message",
        json={"chat_id": chat, "text": text, "chat_type": "group", "chat_title": title, "language": "ru"},
        timeout=5,
    ).raise_for_status()


def member(tg, status, *, chat=GROUP):
    requests.post(
        f"{tg.base}/_emulator/member", json={"chat_id": chat, "status": status, "chat_title": GROUP_TITLE}, timeout=5
    ).raise_for_status()


def kitchen_id(cms):
    points = cms.get("/api/cms/bootstrap").json()["execution_points"]
    return next(point["id"] for point in points if point["code"] == "kitchen")


def connected_group(cms, bot, tg):
    created = cms.post(CREATE, {"title": "Смена кухни", "execution_point_id": kitchen_id(cms)})
    assert created.status_code == 201, created.content
    say_in_group(tg, f"/connect {created.json()['connect']['code']}")
    bot.tick()
    return created.json()["channel"]["id"]


def channel_row(cms, channel_id):
    return next(item for item in cms.get("/api/cms/notification-channels?limit=200").json()["items"] if item["id"] == channel_id)


def test_the_panel_issues_a_code_and_keeps_only_its_fingerprint(cms, crystal, bot, tg):
    created = cms.post(CREATE, {"title": "Смена кухни", "execution_point_id": kitchen_id(cms)})
    assert created.status_code == 201, created.content
    body = created.json()
    code = body["connect"]["code"]
    assert len(code) == 8 and body["connect"]["link"].endswith(f"?startgroup={code}")
    assert body["channel"]["group"]["state"] == "pending"
    assert "bot_token" not in body["channel"]["config_public"]
    with tenant_context(crystal):
        stored = NotificationChannel.objects.get(pk=body["channel"]["id"])
        assert code not in str(stored.config), "в базе только отпечаток кода"
        assert stored.via_platform_bot and stored.user_id is None


def test_connect_in_the_group_binds_it_and_names_the_venue(cms, crystal, bot, tg):
    channel_id = connected_group(cms, bot, tg)
    reply = tg.last(GROUP)["plain"]
    assert "Группа подключена" in reply and "Смена кухни" in reply
    row = channel_row(cms, channel_id)
    assert row["group"]["state"] == "connected" and row["group"]["chat_title"] == GROUP_TITLE
    with tenant_context(crystal):
        assert AuditLog.objects.filter(action="notification.telegram_group_connected", object_id=channel_id).exists()
        stored = NotificationChannel.objects.get(pk=channel_id)
        assert stored.config["chat_id"] == str(GROUP) and "code_hash" not in stored.config, "код погашен"


def test_the_startgroup_link_works_the_same_way(cms, bot, tg):
    """Ссылка `?startgroup=КОД`: Telegram добавляет бота и сам шлёт `/start КОД`."""
    created = cms.post(CREATE, {"title": "Бар", "execution_point_id": None}).json()
    say_in_group(tg, f"/start@itv_emulator_bot {created['connect']['code']}")
    bot.tick()
    assert channel_row(cms, created["channel"]["id"])["group"]["state"] == "connected"
    assert "весь отель" in tg.last(GROUP)["plain"]


def test_a_stale_or_foreign_code_is_refused_clearly(cms, crystal, bot, tg):
    say_in_group(tg, "/connect ZZZZZZZZ")
    bot.tick()
    assert "Код не найден" in tg.last(GROUP)["plain"]

    created = cms.post(CREATE, {"title": "Смена"}).json()
    with tenant_context(crystal):
        channel = NotificationChannel.objects.get(pk=created["channel"]["id"])
        channel.config = {**channel.config, "code_expires_at": (timezone.now() - timedelta(minutes=1)).isoformat()}
        channel.save(update_fields=["config"])
    say_in_group(tg, f"/connect {created['connect']['code']}")
    bot.tick()
    assert "Код истёк" in tg.last(GROUP)["plain"]
    assert channel_row(cms, created["channel"]["id"])["group"]["state"] == "pending"


def test_in_a_group_the_bot_answers_only_its_commands(cms, bot, tg):
    connected_group(cms, bot, tg)
    before = len(tg.messages(GROUP))
    say_in_group(tg, "Кто сегодня на раздаче?")
    bot.tick()
    assert len(tg.messages(GROUP)) == before, "переписка смены — не боту"
    say_in_group(tg, "/disconnect")
    bot.tick()
    assert "только в панели" in tg.last(GROUP)["plain"]


def test_connect_in_a_private_chat_explains_where(bot, tg):
    tg.write(555, "/connect ABCDEFGH")
    bot.tick()
    assert "для группы" in tg.last(555)["plain"]


def test_messages_reach_the_group_through_the_platform_bot(cms, crystal, bot, tg):
    channel_id = connected_group(cms, bot, tg)
    with tenant_context(crystal):
        result = send_test_message(NotificationChannel.objects.get(pk=channel_id))
    assert result["ok"], result
    assert "Проверка канала" in tg.last(GROUP)["plain"]


def test_removing_the_bot_marks_the_channel_and_a_new_code_brings_it_back(cms, crystal, bot, tg):
    channel_id = connected_group(cms, bot, tg)
    member(tg, "kicked")
    bot.tick()
    row = channel_row(cms, channel_id)
    assert row["group"]["state"] == "removed"
    with tenant_context(crystal):
        from apps.notifications.services.events import channels_for_audience

        assert channel_id not in {str(c.pk) for c in channels_for_audience("point", NotificationChannel.objects.get(pk=channel_id).execution_point_id)}

    code = cms.post(f"/api/cms/notification-channels/{channel_id}/connect-code").json()["code"]
    say_in_group(tg, f"/connect {code}")
    bot.tick()
    assert channel_row(cms, channel_id)["group"]["state"] == "connected"


def test_a_supergroup_upgrade_moves_the_address(cms, crystal, bot, tg):
    channel_id = connected_group(cms, bot, tg)
    requests.post(f"{tg.base}/_emulator/migrate", json={"chat_id": GROUP, "to_chat_id": -1009990001}, timeout=5).raise_for_status()
    bot.tick()
    with tenant_context(crystal):
        assert NotificationChannel.objects.get(pk=channel_id).config["chat_id"] == "-1009990001"


def test_deleting_the_channel_says_goodbye_and_leaves(cms, bot, tg, django_capture_on_commit_callbacks):
    channel_id = connected_group(cms, bot, tg)
    with django_capture_on_commit_callbacks(execute=True):
        assert cms.delete(f"/api/cms/notification-channels/{channel_id}").status_code == 200
    assert "бот выходит из группы" in tg.last(GROUP)["plain"]
    assert [str(call["payload"]["chat_id"]) for call in tg.calls("leaveChat")] == [str(GROUP)]


def test_a_manager_connects_groups_only_for_own_venues(cms_manager, cms, bot, tg):
    points = cms.get("/api/cms/bootstrap").json()["execution_points"]
    bar = next(point["id"] for point in points if point["code"] == "bar")
    assert cms_manager.post(CREATE, {"title": "Чужой бар", "execution_point_id": bar}).status_code == 403
    assert cms_manager.post(CREATE, {"title": "Своя кухня", "execution_point_id": kitchen_id(cms)}).status_code == 201
