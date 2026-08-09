"""
Уведомления и эскалация.

Заявка бесполезна, если её никто не увидел. Отдел получает сообщение в свой
канал; если за отведённое время заявку не взяли — она поднимается выше по
ступеням. Взяли — эскалация гаснет.

Контракт и гарантии движка — docs/notifications-api-contract.md.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .vocabulary import ChannelType


class NotificationChannel(TenantModel):
    """
    Куда слать. Канал принадлежит отделу (общий чат кухни) либо сотруднику
    (личный Telegram старшего) — привязка решает, кого достанет ступень.
    """

    type = models.CharField(max_length=32, choices=ChannelType.choices, default=ChannelType.LOG)
    title = models.CharField(max_length=128)
    is_active = models.BooleanField(default=True)

    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notification_channels",
    )
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notification_channels",
    )

    # Секреты (bot_token) наружу не отдаются: в API уходит маскированная копия.
    config = models.JSONField(default=dict, blank=True)
    # {lang: {"subject": "...", "body": "..."}}
    templates = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "notifications_channel"
        ordering = ["title"]

    def __str__(self) -> str:
        return f"{self.title} ({self.type})"
