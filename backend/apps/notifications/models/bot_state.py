"""
ПУЛЬС БОТА ПЛАТФОРМЫ (партия 28).

Бот — ещё одна служба в compose, и молчащий бот выглядит ровно как
работающий: сообщения просто не приходят. Поэтому, как у службы расписания,
строка состояния обновляется на каждом круге опроса, а консоль платформы
показывает: жив ли, как зовут бота, когда опрашивал, что сломалось.

Имя бота хранится здесь, а не в настройках: служба спрашивает его у
мессенджера (`getMe`) при старте. Ссылка «подключить» строится по этому имени
— поменяли токен на другого бота, и ссылки поменялись сами.

Токена здесь нет — только хвост (последние четыре символа), чтобы отличить
«поменяли токен» от «не поменяли».

Таблица ПЛАТФОРМЕННАЯ: бот один на все отели.
"""

from __future__ import annotations

from django.db import models


class MessengerBotState(models.Model):
    class Status(models.TextChoices):
        NO_TOKEN = "no_token", "Токен не задан"
        REJECTED = "rejected", "Токен не принят"
        CONFLICT = "conflict", "Бота опрашивает другой сервер"
        ERROR = "error", "Мессенджер недоступен"
        OK = "ok", "На связи"

    messenger = models.CharField(max_length=16, primary_key=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NO_TOKEN)
    username = models.CharField(max_length=64, blank=True)
    token_tail = models.CharField(max_length=8, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    last_poll_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    # Очередь входящих подтверждается сдвигом: после перезапуска служба не
    # перечитывает то, что уже обработала.
    update_offset = models.BigIntegerField(default=0)

    class Meta:
        db_table = "notifications_bot_state"

    def __str__(self) -> str:
        return f"{self.messenger}: {self.status}"
