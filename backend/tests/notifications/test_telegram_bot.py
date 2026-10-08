"""
БОТ ПЛАТФОРМЫ В TELEGRAM (партия 28): привязка, личные уведомления, кнопки.

Настоящий Telegram не трогается: служба и отправка ходят настоящим `requests`
в эмулятор Bot API (`apps/notifications/messengers/emulator.py`), поднятый в
потоке. Меняется только адрес (`TELEGRAM_API_URL`) — путь кода тот же.

Укус на каждую часть: истёкший код, повторное нажатие, 429 с Retry-After,
бот заблокирован, токен не принят, чужой отель. И сторож: токен не попадает
ни в журнал, ни в ответы API, ни в логи.

`transaction=True`: бот — платформенный процесс, он читает и пишет через
платформенное подключение, и строки, записанные транзакцией теста, иначе бы
не увидел.
"""

from __future__ import annotations

import json
import logging

import pytest
import requests
from django.core import mail
from django.utils import timezone

from apps.accounts.models import ContactBindingCode, StaffAssignment, User
from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.notifications.messengers import emulator
from apps.notifications.messengers.telegram import TelegramBot, compose
from apps.notifications.models import (
    EscalationRule,
    EventDelivery,
    EventRecord,
    MessengerBotState,
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
    TargetKind,
)
from apps.notifications.services import bot_actions, events, personal
from apps.notifications.services.bot_service import IDLE_SLEEP, PAUSE_MIN, BotService
from apps.orders.models import Order
from tests.conftest import CmsClient, host_for, staff_token_for

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

# Похож на настоящий: число, двоеточие, секрет. Хвост — «9fZq».
TOKEN = "777000111:AAE-secret-token-for-tests-9fZq"
CONTACTS = "/api/staff/me/contacts"
MANAGER_CHAT, CHEF_CHAT, STRANGER_CHAT = 7001, 7002, 7003


# --- Эмулятор -----------------------------------------------------------------------


@pytest.fixture(scope="session")
def tg_server():
    server = emulator.serve(0)
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


class Telegram:
    """Человек по ту сторону: пишет боту, жмёт кнопки, читает, что пришло."""

    def __init__(self, base: str):
        self.base = base

    def write(self, chat, text, *, language="ru", username="petr"):
        requests.post(
            f"{self.base}/_emulator/message",
            json={"chat_id": chat, "text": text, "language": language, "username": username},
            timeout=5,
        ).raise_for_status()

    def press(self, chat, message_id, data):
        requests.post(
            f"{self.base}/_emulator/press",
            json={"chat_id": chat, "message_id": message_id, "data": data},
            timeout=5,
        ).raise_for_status()

    def scenario(self, **values):
        requests.post(f"{self.base}/_emulator/scenario", json=values, timeout=5).raise_for_status()

    def messages(self, chat) -> list[dict]:
        return requests.get(f"{self.base}/_emulator/messages", params={"chat_id": chat}, timeout=5).json()["messages"]

    def last(self, chat) -> dict:
        messages = self.messages(chat)
        assert messages, f"боту нечего было сказать в чат {chat}"
        return messages[-1]

    def calls(self, method=None) -> list[dict]:
        params = {"method": method} if method else {}
        return requests.get(f"{self.base}/_emulator/calls", params=params, timeout=5).json()["calls"]

    def answers(self) -> list[str]:
        return [call["payload"]["text"] for call in self.calls("answerCallbackQuery")]


@pytest.fixture
def tg(tg_server, settings):
    settings.TELEGRAM_API_URL = tg_server
    settings.TELEGRAM_BOT_TOKEN = TOKEN
    requests.post(f"{tg_server}/_emulator/reset", timeout=5).raise_for_status()
    return Telegram(tg_server)


@pytest.fixture
def bot(tg):
    """Служба, сделавшая первый круг: имя спрошено, пульс свежий."""
    service = BotService(TelegramBot(), poll_timeout=0)
    assert service.tick() == 0
    return service


def staff(client, hotel, login) -> CmsClient:
    return CmsClient(client, hotel, staff_token_for(client, hotel, login))


def user_of(hotel, login) -> User:
    with tenant_context(hotel):
        return User.objects.get(email=f"{login}@{hotel.subdomain}.local")


def bind(client, hotel, login, chat, bot, tg) -> User:
    issued = staff(client, hotel, login).post(f"{CONTACTS}/telegram/binding-code")
    assert issued.status_code == 200, issued.content
    tg.write(chat, f"/start {issued.json()['code']}")
    bot.tick()
    user = user_of(hotel, login)
    assert user.telegram_chat_id == str(chat), tg.last(chat)["text"]
    return user


# --- 1. Служба -------------------------------------------------------------------------


def test_the_bot_asks_its_name_and_the_link_uses_it(client, crystal, bot, tg):
    state = MessengerBotState.objects.get(messenger="telegram")
    assert (state.status, state.username, state.token_tail) == ("ok", "itv_emulator_bot", "…9fZq")

    issued = staff(client, crystal, "chef").post(f"{CONTACTS}/telegram/binding-code").json()
    assert issued["link"] == f"https://t.me/itv_emulator_bot?start={issued['code']}"


def test_without_a_token_the_service_sleeps_and_the_panel_says_not_connected(client, crystal, tg, settings):
    settings.TELEGRAM_BOT_TOKEN = ""
    service = BotService(TelegramBot(), poll_timeout=0)
    assert service.tick() == IDLE_SLEEP
    assert tg.calls() == [], "без токена служба никуда не ходит"
    assert MessengerBotState.objects.get(messenger="telegram").status == "no_token"

    chef = staff(client, crystal, "chef")
    state = chef.get(CONTACTS).json()["messengers"]["telegram"]
    assert (state["binding_available"], state["unavailable_reason"]) == (False, "no_bot")
    refused = chef.post(f"{CONTACTS}/telegram/binding-code")
    assert refused.status_code == 409 and "binding_unavailable" in refused.content.decode()


def test_a_rejected_token_does_not_crash_the_service_and_the_pause_grows(tg, settings, caplog):
    """Укус: токен не принят."""
    bad = "777000111:invalid-SECRET-zz11"
    settings.TELEGRAM_BOT_TOKEN = bad
    service = BotService(TelegramBot(), poll_timeout=0)
    with caplog.at_level(logging.INFO):
        pauses = [service.tick(), service.tick(), service.tick()]
    assert pauses == [PAUSE_MIN, PAUSE_MIN * 2, PAUSE_MIN * 4]
    state = MessengerBotState.objects.get(messenger="telegram")
    assert state.status == "rejected"
    assert "токен не принят (…zz11)" in state.last_error
    assert "токен не принят" in caplog.text
    assert bad not in caplog.text and bad not in state.last_error


def test_a_second_poller_is_named_as_such(bot, tg):
    tg.scenario(conflict=True)
    assert bot.tick() == PAUSE_MIN
    state = MessengerBotState.objects.get(messenger="telegram")
    assert state.status == "conflict"
    assert "409" in state.last_error


# --- 2. Привязка ---------------------------------------------------------------------------


def test_start_with_a_code_binds_and_answers_with_name_and_hotel(client, crystal, bot, tg):
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    reply = tg.last(CHEF_CHAT)
    assert f"Подключено: {user.full_name}, " in reply["plain"]
    assert reply["parse_mode"] == "HTML"
    with tenant_context(crystal):
        channel = NotificationChannel.objects.get(user=user, via_platform_bot=True)
        assert channel.is_active and channel.type == "telegram"
        assert "bot_token" not in channel.config, "токен в канале не хранится"
        assert AuditLog.objects.filter(action="staff.contact.linked", object_id=user.pk).exists()


@pytest.mark.parametrize(
    ("spoil", "phrase"),
    [
        (lambda codes: codes.update(expires_at=timezone.now()), "Код истёк"),
        (lambda codes: codes.update(used_at=timezone.now()), "уже использован"),
        (lambda codes: codes.update(revoked_at=timezone.now()), "заменён новым"),
    ],
)
def test_a_stale_code_gets_a_clear_refusal(client, crystal, bot, tg, spoil, phrase):
    """Укус: истёкший / использованный / отозванный код."""
    code = staff(client, crystal, "chef").post(f"{CONTACTS}/telegram/binding-code").json()["code"]
    with tenant_context(crystal):
        spoil(ContactBindingCode.objects.all())
    tg.write(CHEF_CHAT, f"/start {code}")
    bot.tick()
    assert phrase in tg.last(CHEF_CHAT)["plain"]
    assert user_of(crystal, "chef").telegram_chat_id == ""


def test_a_foreign_code_binds_nobody(bot, tg):
    tg.write(STRANGER_CHAT, "/start not-a-real-code")
    bot.tick()
    assert "Код не найден" in tg.last(STRANGER_CHAT)["plain"]


def test_a_person_in_two_hotels_has_one_chat_and_stop_unbinds_both(client, crystal, aurora, bot, tg):
    chef = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    owner = bind(client, aurora, "owner", CHEF_CHAT, bot, tg)

    tg.write(CHEF_CHAT, "/start")
    bot.tick()
    listed = tg.last(CHEF_CHAT)["plain"]
    assert chef.full_name in listed and owner.full_name in listed

    tg.write(CHEF_CHAT, "/stop")
    bot.tick()
    assert "Отключено" in tg.last(CHEF_CHAT)["plain"]
    assert user_of(crystal, "chef").telegram_chat_id == ""
    assert user_of(aurora, "owner").telegram_chat_id == ""
    assert not NotificationChannel.all_objects.using("platform").filter(
        via_platform_bot=True, is_active=True
    ).exists()


def test_unlinking_from_the_profile_switches_the_channel_off(client, crystal, bot, tg):
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    staff(client, crystal, "chef").delete(f"{CONTACTS}/telegram")
    with tenant_context(crystal):
        assert not NotificationChannel.objects.get(user=user, via_platform_bot=True).is_active


def test_binding_only_in_a_private_chat(client, crystal, bot, tg):
    code = staff(client, crystal, "chef").post(f"{CONTACTS}/telegram/binding-code").json()["code"]
    requests.post(
        f"{tg.base}/_emulator/message",
        json={"chat_id": -100500, "text": f"/start {code}", "chat_type": "group"},
        timeout=5,
    )
    bot.tick()
    assert "личном чате" in tg.last(-100500)["plain"]
    assert user_of(crystal, "chef").telegram_chat_id == ""


def test_the_admin_invites_by_email_with_a_link_to_the_profile(cms, crystal, bot, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    chef = user_of(crystal, "chef")
    response = cms.post(f"/api/cms/staff/{chef.pk}/telegram-invite")
    assert response.status_code == 200, response.content
    (letter,) = mail.outbox
    assert letter.to == [chef.email]
    assert "/admin/profile?connect=telegram" in letter.body
    with tenant_context(crystal):
        assert not ContactBindingCode.objects.exists(), "в письме ссылка на профиль, а не код"


def test_a_manager_cannot_send_invitations(cms_manager, crystal, bot):
    chef = user_of(crystal, "chef")
    assert cms_manager.post(f"/api/cms/staff/{chef.pk}/telegram-invite").status_code == 403


# --- 3. Доставка ----------------------------------------------------------------------


def _handover(crystal, user, preview):
    with tenant_context(crystal):
        return events.notify(
            "chat.handover",
            {"room_number": "305", "from_name": "Анна", "preview": preview},
            user_id=user.pk,
        )


def test_a_personal_event_arrives_as_escaped_html_not_markdown(client, crystal, bot, tg, deliver_inline):
    """П.31: звёздочки и подчёркивания больше не ломают разбор."""
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    record = _handover(crystal, user, "<b>VIP</b> *срочно* _Иван_Петров_")
    message = tg.last(CHEF_CHAT)
    assert message["parse_mode"] == "HTML"
    assert message["text"].startswith("<b>")
    assert "&lt;b&gt;VIP&lt;/b&gt; *срочно* _Иван_Петров_" in message["text"]
    assert message["buttons"] == [], "у сообщений чата кнопок нет"
    with tenant_context(crystal):
        assert EventRecord.objects.get(pk=record.pk).outcome == "sent"
        channel = NotificationChannel.objects.get(user=user, via_platform_bot=True)
        assert channel.last_sent_at is not None


def test_429_waits_for_retry_after(client, crystal, bot, tg, notifications_on, monkeypatch):
    """Укус: 429 с Retry-After — повтор не раньше, чем разрешили."""
    from apps.notifications import tasks

    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    queued = []
    monkeypatch.setattr(events, "_dispatch", lambda ids, hotel_id: queued.extend(ids))
    _handover(crystal, user, "привет")
    with tenant_context(crystal):
        # У повара в сиде есть и другие личные каналы — берём Telegram.
        (delivery_id,) = EventDelivery.objects.filter(
            pk__in=queued, channel__via_platform_bot=True
        ).values_list("pk", flat=True)

    # Сто двадцать секунд — дольше собственной паузы повтора (15 с): так видно,
    # чья пауза взята. С семью секундами проверка не отличала бы одно от другого.
    tg.scenario(rate_limit={"method": "sendMessage", "times": 1, "retry_after": 120})
    countdowns = []
    real = tasks._backoff
    monkeypatch.setattr(
        tasks, "_backoff", lambda retries, retry_after=None: countdowns.append(real(retries, retry_after)) or countdowns[-1]
    )
    tasks.deliver_event.apply(args=(str(delivery_id), str(crystal.pk)))

    assert len(countdowns) == 1 and countdowns[0] > 120, f"повтор раньше Retry-After: {countdowns}"
    with tenant_context(crystal):
        delivery = EventDelivery.objects.get(pk=delivery_id)
        assert (delivery.status, delivery.attempts) == (NotificationStatus.SENT, 2)


def test_a_blocked_bot_is_marked_and_no_longer_addressed(client, crystal, cms, bot, tg, deliver_inline):
    """Укус: человек заблокировал бота."""
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    tg.scenario(blocked=[str(CHEF_CHAT)])
    record = _handover(crystal, user, "первое")
    with tenant_context(crystal):
        channel = NotificationChannel.objects.get(user=user, via_platform_bot=True)
        delivery = EventDelivery.objects.get(record_id=record.pk, channel=channel)
        assert delivery.status == NotificationStatus.FAILED
        assert channel.blocked_at is not None
        assert "заблокирован" in channel.last_error

    row = next(item for item in cms.get("/api/cms/staff?limit=200").json()["items"] if item["id"] == str(user.pk))
    assert row["messengers"]["telegram"]["blocked"] is True
    assert row["messengers"]["telegram"]["last_error"]

    second = _handover(crystal, user, "второе")
    with tenant_context(crystal):
        assert not EventDelivery.objects.filter(record_id=second.pk, channel=channel).exists(), (
            "заблокированному не шлём"
        )

    tg.scenario(blocked=[])
    tg.write(CHEF_CHAT, "/start")
    bot.tick()
    with tenant_context(crystal):
        assert NotificationChannel.objects.get(user=user, via_platform_bot=True).blocked_at is None


def test_the_hotel_switch_stops_binding_and_delivery(client, crystal, cms, bot, tg, deliver_inline):
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    switched = cms.put("/api/cms/notifications/telegram", {"enabled": False})
    assert switched.status_code == 200 and switched.json()["enabled"] is False

    record = _handover(crystal, user, "не уйдёт")
    with tenant_context(crystal):
        assert not EventDelivery.objects.filter(
            record_id=record.pk, channel__via_platform_bot=True
        ).exists(), "выключенный отелем Telegram не адресуется"
    refused = staff(client, crystal, "manager.restaurant").post(f"{CONTACTS}/telegram/binding-code")
    assert refused.status_code == 409 and "telegram_disabled" in refused.content.decode()

    cms.put("/api/cms/notifications/telegram", {"enabled": True})
    assert user_of(crystal, "chef").telegram_chat_id == str(CHEF_CHAT), "привязки пережили выключение"


def test_a_manager_cannot_flip_the_hotel_switch(cms_manager, bot):
    assert cms_manager.put("/api/cms/notifications/telegram", {"enabled": False}).status_code == 403


# --- 4. Кнопки ------------------------------------------------------------------------------


def _order(client, crystal, key) -> Order:
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    auth = {"HTTP_HOST": host_for(crystal), "HTTP_AUTHORIZATION": f"Bearer {token}"}
    menu = client.get("/api/guest/catalog?type=product", **auth).json()
    item_id = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    response = client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY=key,
        **auth,
    )
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        return Order.objects.select_related("status", "execution_point", "hotel").get(pk=response.json()["id"])


def _escalate_to_managers(crystal, order, request):
    """Первая ступень правила кухни — руководителям: им и придёт личное сообщение."""
    request.getfixturevalue("deliver_inline")
    from apps.notifications.services import plan_escalation, run_due_steps

    with tenant_context(crystal):
        rule = EscalationRule.objects.get(execution_point_id=order.execution_point_id, is_active=True)
        rule.steps.filter(delay_minutes=0).update(target_kind=TargetKind.MANAGER)
        run_due_steps(plan_escalation(order))


@pytest.fixture
def escalated(client, crystal, bot, tg, request):
    """Заказ кухни, личное сообщение руководителю с кнопкой «Взять в работу»."""
    manager = bind(client, crystal, "manager.restaurant", MANAGER_CHAT, bot, tg)
    chef = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)
    order = _order(client, crystal, f"tg-{request.node.name[:40]}")
    _escalate_to_managers(crystal, order, request)
    message = tg.last(MANAGER_CHAT)
    take = next(b for b in message["buttons"] if b.get("callback_data"))
    return {"order": order, "manager": manager, "chef": chef, "message": message, "take": take["callback_data"]}


def test_the_take_button_accepts_the_order_and_rewrites_the_message(crystal, bot, tg, escalated):
    order, manager, message = escalated["order"], escalated["manager"], escalated["message"]
    assert escalated["take"] == f"o:{order.pk.hex}"
    assert [b["text"] for b in message["buttons"]] == ["Взять в работу"], "локальный адрес — без ссылки"

    tg.press(MANAGER_CHAT, message["message_id"], escalated["take"])
    bot.tick()

    with tenant_context(crystal):
        order.refresh_from_db()
        assert order.assignee_id == manager.pk and order.accepted_at is not None
        audit = AuditLog.objects.get(action="bot.take", object_id=order.pk)
        assert (audit.actor_id, audit.payload["result"]) == (manager.pk, "done")
    edited = tg.last(MANAGER_CHAT)
    clock = crystal.to_local(order.accepted_at).strftime("%H:%M")
    assert f"Взял {manager.full_name}, {clock}" in edited["plain"]
    assert edited["buttons"] == [], "кнопка действия после действия пропадает"
    assert "Заказ ваш" in tg.answers()


def test_a_repeated_press_says_who_took_it(crystal, bot, tg, escalated):
    """Укус: повторное нажатие — «уже взял Пётр»."""
    message, take = escalated["message"], escalated["take"]
    tg.press(MANAGER_CHAT, message["message_id"], take)
    bot.tick()
    tg.press(CHEF_CHAT, message["message_id"], take)
    bot.tick()
    assert f"Уже взял {escalated['manager'].full_name}" in tg.answers()
    with tenant_context(crystal):
        results = list(
            AuditLog.objects.filter(action="bot.take").order_by("created_at").values_list("payload__result", flat=True)
        )
    assert results == ["done", "already_taken"], "каждое нажатие — в журнал"


def test_a_closed_order_says_so(crystal, bot, tg, escalated):
    from apps.orders.services import change_status, get_order

    with tenant_context(crystal):
        change_status(get_order(escalated["order"].pk), to_code="done", actor_type="staff")
    tg.press(MANAGER_CHAT, escalated["message"]["message_id"], escalated["take"])
    bot.tick()
    assert "Заказ уже закрыт" in tg.answers()
    assert "Заказ закрыт" in tg.last(MANAGER_CHAT)["plain"]


def test_rights_are_checked_at_press_time(crystal, bot, tg, escalated):
    with tenant_context(crystal):
        StaffAssignment.objects.filter(user=escalated["chef"]).update(is_active=False)
    tg.press(CHEF_CHAT, escalated["message"]["message_id"], escalated["take"])
    bot.tick()
    assert "Нет прав на это действие" in tg.answers()
    with tenant_context(crystal):
        escalated["order"].refresh_from_db()
        assert escalated["order"].assignee_id is None


def test_a_press_from_another_hotel_does_nothing(client, crystal, aurora, bot, tg, escalated):
    """Укус: чужой отель — аккаунт привязан в «Авроре», заказ «Кристалла»."""
    bind(client, aurora, "owner", STRANGER_CHAT, bot, tg)
    tg.press(STRANGER_CHAT, escalated["message"]["message_id"], escalated["take"])
    bot.tick()
    assert "не подключён в отеле этой заявки" in " ".join(tg.answers())
    with tenant_context(crystal):
        escalated["order"].refresh_from_db()
        assert escalated["order"].assignee_id is None
        audit = AuditLog.objects.get(action="bot.take", object_id=escalated["order"].pk)
        assert (audit.actor_id, audit.payload["result"]) == (None, "not_linked")


def test_a_switched_off_hotel_ignores_presses(crystal, cms, bot, tg, escalated):
    cms.put("/api/cms/notifications/telegram", {"enabled": False})
    tg.press(MANAGER_CHAT, escalated["message"]["message_id"], escalated["take"])
    bot.tick()
    assert "выключил" in " ".join(tg.answers())


def test_the_tracker_link_only_for_a_public_address(client, crystal, settings):
    assert bot_actions.is_public("https://crystal.app.147.45.245.172.sslip.io/tracker/order/1")
    assert bot_actions.is_public("https://hotel.example.com/x")
    for local in (
        "http://crystal.guest.localhost/tracker",
        "http://localhost:5183/x",
        "http://192.168.155.17/x",
        "http://backend:8000/x",
        "http://hotel.local/x",
    ):
        assert not bot_actions.is_public(local), local

    order = _order(client, crystal, "tg-link")
    settings.GUEST_APP_BASE_DOMAIN = "app.example.com"
    with tenant_context(crystal):
        buttons = bot_actions.order_buttons(order, "en")
    link = next(b for b in buttons if b.url)
    assert link.label == "Open in tracker"
    assert link.url.endswith(f"crystal.app.example.com/tracker/order/{order.pk}")


def test_triage_button_on_a_low_rating(client, crystal, bot, tg):
    from tests.chat.api.test_chat_reviews import _finished_order, guest_for

    manager = bind(client, crystal, "manager.restaurant", MANAGER_CHAT, bot, tg)
    owner = bind(client, crystal, "owner", STRANGER_CHAT, bot, tg)
    guest = guest_for(client, crystal, room="212")
    order_id = _finished_order(client, crystal, guest, key="tg-triage")
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 1, "comment": "холодно"}).json()["id"]

    with tenant_context(crystal):
        (button,) = bot_actions.event_buttons("review.low", {"order_id": order_id}, "ru")
    assert (button.label, button.action) == ("Разобрать", f"r:{review_id.replace('-', '')}")

    tg.write(MANAGER_CHAT, "/help")  # сообщение, под которым «кнопка»
    bot.tick()
    message = tg.last(MANAGER_CHAT)
    tg.press(MANAGER_CHAT, message["message_id"], button.action)
    bot.tick()
    assert "Отзыв ваш" in tg.answers()
    assert f"Разбирает {manager.full_name}" in tg.last(MANAGER_CHAT)["plain"]

    tg.press(STRANGER_CHAT, message["message_id"], button.action)
    bot.tick()
    assert f"Уже разбирает {manager.full_name}" in tg.answers()
    assert owner.pk != manager.pk


def test_a_stale_button_is_answered_not_crashed(bot, tg):
    tg.press(CHEF_CHAT, 0, "o:not-a-uuid")
    bot.tick()
    assert "Кнопка устарела" in tg.answers()


# --- 5. Видимость ---------------------------------------------------------------------------


def test_the_platform_console_shows_the_bot(client, bot):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email="root@platform.test", password="platform12345")
    token = client.post(
        "/api/v1/platform/auth/login",
        data={"email": "root@platform.test", "password": "platform12345"},
        content_type="application/json",
        HTTP_HOST="guest.localhost",
    ).json()["access"]
    kw = {"HTTP_HOST": "guest.localhost", "HTTP_AUTHORIZATION": f"Bearer {token}"}
    state = client.get("/api/v1/platform/bot", **kw).json()
    assert (state["alive"], state["username"], state["token_tail"]) == (True, "itv_emulator_bot", "…9fZq")
    health = client.get("/api/v1/platform/overview", **kw).json()["health"]
    signal = next(s for s in health if s["code"].startswith("bot_"))
    assert (signal["code"], signal["name"]) == ("bot_ok", "itv_emulator_bot")


# --- Сторож: токен не утекает -----------------------------------------------------------------


def test_the_token_never_reaches_the_journal_api_or_logs(client, crystal, cms, bot, tg, settings, deliver_inline, caplog):
    caplog.set_level(logging.DEBUG)
    user = bind(client, crystal, "chef", CHEF_CHAT, bot, tg)

    # Отказы всех видов: блокировка, сеть (в тексте исключения requests — адрес с токеном), 429.
    tg.scenario(blocked=[str(CHEF_CHAT)])
    _handover(crystal, user, "раз")
    tg.scenario(blocked=[])
    with tenant_context(crystal):
        NotificationChannel.objects.filter(user=user).update(blocked_at=None)
    settings.TELEGRAM_API_URL = "http://127.0.0.1:9"  # закрытый порт
    _handover(crystal, user, "два")
    BotService(TelegramBot(), poll_timeout=0).tick()

    texts = [caplog.text]
    with tenant_context(crystal):
        texts += [json.dumps(row) for row in AuditLog.objects.values_list("payload", flat=True)]
        texts += list(EventDelivery.objects.values_list("error", flat=True))
        texts += list(NotificationLog.objects.values_list("error", flat=True))
        texts += list(NotificationChannel.objects.values_list("last_error", flat=True))
        texts += [json.dumps(row) for row in NotificationChannel.objects.values_list("config", flat=True)]
    state = MessengerBotState.objects.get(messenger="telegram")
    texts += [state.last_error, state.token_tail, state.username]
    texts += [
        cms.get("/api/cms/staff?limit=200").content.decode(),
        cms.get("/api/cms/notifications/telegram").content.decode(),
        cms.get("/api/cms/notification-channels").content.decode(),
        staff(client, crystal, "chef").get(CONTACTS).content.decode(),
    ]
    joined = "\n".join(texts)
    assert "…9fZq" in joined, "хвост показывается — значит, проверка видела ошибки"
    assert TOKEN not in joined
    assert TOKEN.split(":")[1] not in joined


# Без событий после коммита и второго подключения — хватает отката (партия 41).
@pytest.mark.django_db(databases=["default", "platform"])
def test_compose_escapes_everything_but_our_bold_subject():
    assert compose("A & <B>", "x < y > z & *w*") == "<b>A &amp; &lt;B&gt;</b>\nx &lt; y &gt; z &amp; *w*"


def test_take_on_an_order_assigned_to_someone_else_names_the_assignee(crystal, bot, tg, escalated):
    """
    УКУС (партия 47). Заказ назначен повару — руководитель жмёт «Взять» в боте.
    Человек видит «Назначено: Пётр, повар», а не ошибку и не «заявка закрыта»;
    заказ остаётся за поваром и не становится «принятым».
    """
    from apps.orders.services.tracker import assign_order

    order, manager, chef = escalated["order"], escalated["manager"], escalated["chef"]
    with tenant_context(crystal):
        assign_order(manager, order.pk, assignee_id=chef.pk)

    tg.press(MANAGER_CHAT, escalated["message"]["message_id"], escalated["take"])
    bot.tick()

    assert f"Назначено: {chef.full_name}" in tg.answers()
    with tenant_context(crystal):
        order.refresh_from_db()
        assert order.assignee_id == chef.pk and order.accepted_at is None
        audit = AuditLog.objects.filter(action="bot.take", object_id=order.pk).latest("created_at")
        assert audit.payload["result"] == "assigned_to_other"
