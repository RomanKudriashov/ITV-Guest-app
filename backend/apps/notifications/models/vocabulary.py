"""Словари уведомлений: тип канала, кому шлём, чем кончилось."""

from __future__ import annotations

from django.db import models


class ChannelType(models.TextChoices):
    TELEGRAM = "telegram", "Telegram"
    EMAIL = "email", "E-mail"
    # Пишет в лог приложения и всегда успешен. Без него разработка и CI
    # требовали бы настоящих кредов у каждого, кто запускает проект.
    LOG = "log", "Лог (разработка)"


class TargetKind(models.TextChoices):
    POINT = "point", "Все каналы отдела"
    LEAD = "lead", "Старшие смены"
    MANAGER = "manager", "Руководители"
    CHANNEL = "channel", "Конкретный канал"


class NotificationStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Запланировано"
    SENT = "sent", "Отправлено"
    FAILED = "failed", "Ошибка канала"
    SKIPPED = "skipped", "Пропущено"
    CANCELLED = "cancelled", "Погашено (заказ приняли)"
