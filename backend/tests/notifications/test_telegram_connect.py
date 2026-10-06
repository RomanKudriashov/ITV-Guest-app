"""
ПОДКЛЮЧЕНИЕ К TELEGRAM — КОРОТКОЕ, С БЫСТРЫМ ПОВТОРОМ (п.66 бэклога).

Маршрут со стенда теряет часть подключений (п.67). Раньше одно потерянное
подключение ждало 35 с (таймаут длинного опроса на всё), а служба после
отказа уходила в нарастающую паузу. Здесь — без сети, подменой `requests.post`.
"""

from __future__ import annotations

import pytest
import requests

from apps.notifications.messengers.base import MessengerError
from apps.notifications.messengers.telegram import CONNECT_TIMEOUT, TelegramBot


class FakePost:
    """`requests.post`, который сначала выдаёт заданные исключения, потом — ответ."""

    def __init__(self, failures, result=None):
        self.failures = list(failures)
        self.result = result if result is not None else []
        self.calls: list[tuple] = []

    def __call__(self, url, json=None, timeout=None):
        self.calls.append(timeout)
        if self.failures:
            raise self.failures.pop(0)
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"ok": true, "result": []}'
        return response


def lost_connection():
    return requests.ConnectionError(
        "HTTPSConnectionPool: Max retries exceeded (Caused by NewConnectionError('Failed to establish a new connection'))"
    )


@pytest.fixture
def bot():
    return TelegramBot(token="123456:" + "A" * 30, api_url="https://api.telegram.org")


def test_a_lost_connection_is_retried_at_once_and_the_poll_goes_through(bot, monkeypatch):
    fake = FakePost([requests.ConnectTimeout("connect timed out")])
    monkeypatch.setattr(requests, "post", fake)
    assert bot.updates(0, 25) == []
    assert len(fake.calls) == 2, "одна потеря — один немедленный повтор"


def test_connect_waits_seconds_while_the_long_poll_reads_as_before(bot, monkeypatch):
    fake = FakePost([])
    monkeypatch.setattr(requests, "post", fake)
    bot.updates(0, 25)
    assert fake.calls == [(CONNECT_TIMEOUT, 35)]
    assert CONNECT_TIMEOUT <= 5


def test_refused_socket_is_also_retried(bot, monkeypatch):
    fake = FakePost([lost_connection(), lost_connection()])
    monkeypatch.setattr(requests, "post", fake)
    bot.updates(0, 25)
    assert len(fake.calls) == 3


def test_a_broken_read_is_not_retried__the_message_may_be_out_already(bot, monkeypatch):
    fake = FakePost([requests.ReadTimeout("read timed out")])
    monkeypatch.setattr(requests, "post", fake)
    with pytest.raises(MessengerError):
        bot.send("42", "", "текст", [])
    assert len(fake.calls) == 1


def test_three_lost_connections_in_a_row_are_a_failure(bot, monkeypatch):
    fake = FakePost([requests.ConnectTimeout("x")] * 3)
    monkeypatch.setattr(requests, "post", fake)
    with pytest.raises(MessengerError) as caught:
        bot.updates(0, 25)
    assert "A" * 30 not in caught.value.detail, "токен не утёк в текст ошибки"
    assert len(fake.calls) == 3


# Круг бота закрывает соединения (close_old_connections) — как у тестов бота,
# настоящие транзакции и платформенное подключение.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_one_lost_connection_does_not_send_the_service_to_pause(bot, monkeypatch):
    from apps.notifications.services.bot_service import BotService

    monkeypatch.setattr(bot, "me", lambda: "itv_test_bot")
    fake = FakePost([requests.ConnectTimeout("connect timed out")])
    monkeypatch.setattr(requests, "post", fake)
    service = BotService(bot)
    assert service.tick() == 0
    assert service.pause == 0
