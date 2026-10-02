"""
СЛУЖБА БОТА ПЛАТФОРМЫ: длинный опрос Telegram (партия 28).

Одна на платформу: один токен — один опрашивающий. Логика круга —
`apps/notifications/services/bot_service.py`; здесь только цикл, сон и мягкая
остановка. Падать по кругу служба не должна: нет токена — спит, токен не
принят — ждёт с растущей паузой, и всё это видно в пульсе в консоли платформы.
"""

from __future__ import annotations

import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.notifications import messengers
from apps.notifications.services.bot_service import BotService


class Command(BaseCommand):
    help = "Бот платформы: опрашивает Telegram, принимает привязки и нажатия кнопок"

    def add_arguments(self, parser) -> None:
        parser.add_argument("--once", action="store_true", help="Один круг и выход — для проверок")

    def handle(self, *args, **options) -> None:
        stopping = {"now": False}

        def stop(*_args):
            stopping["now"] = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)

        service = BotService(messengers.get("telegram"), poll_timeout=settings.TELEGRAM_POLL_TIMEOUT)
        tail = service.bot.token_tail() or "не задан"
        self.stdout.write(f"Бот запущен: Telegram, токен {tail}")
        while not stopping["now"]:
            pause = service.tick()
            if options["once"]:
                return
            # Сон по секунде: SIGTERM при остановке контейнера не ждёт пять минут.
            for _ in range(pause):
                if stopping["now"]:
                    break
                time.sleep(1)
        self.stdout.write("Бот остановлен")
