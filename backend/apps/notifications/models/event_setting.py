"""
НАСТРОЙКА СОБЫТИЯ — РЕШЕНИЕ ОТЕЛЯ О ТОМ, ЧТО МЫ ЗАВЕЛИ.

Событие заводим мы (`apps/notifications/events.py`), отель его не создаёт, но
решает: слать ли, кому, какими каналами и каким текстом.

СТРОКИ НЕТ — ЗНАЧИТ, ПО УМОЛЧАНИЮ. Настройка появляется, только когда отель
что-то поменял. Поэтому новое событие справочника приходит во все отели сразу
со своим значением по умолчанию, и миграции данных ему не нужно.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .channel import NotificationChannel


class EventSetting(TenantModel):
    code = models.CharField(max_length=64)
    is_enabled = models.BooleanField(default=True)
    # Пусто — адресат справочника. `channel` — один выбранный канал.
    audience = models.CharField(max_length=16, blank=True)
    channel = models.ForeignKey(
        NotificationChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Какими видами каналов слать; пусто — любыми. Руководитель с почтой и
    # Telegram может хотеть отмены в мессенджер, а не в почту.
    channel_types = models.JSONField(default=list, blank=True)
    # Текст отеля: {язык: {subject, body}}. Пустой язык — текст справочника.
    templates = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "notifications_event_setting"
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_event_setting_per_hotel")
        ]

    def __str__(self) -> str:
        return f"{self.code} [{'вкл' if self.is_enabled else 'выкл'}]"
