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

    # ЛИЧНЫЙ TELEGRAM ЧЕРЕЗ БОТА ПЛАТФОРМЫ (партия 28). Такой канал заводит
    # привязка, а не администратор: токена в нём нет (он один на платформу и
    # живёт в окружении), адрес — `telegram_chat_id` сотрудника, читается в
    # момент отправки. Отвязка канал выключает. В списке каналов отеля его нет:
    # им управляет человек из профиля, а не форма канала.
    via_platform_bot = models.BooleanField(default=False)

    # Чем кончилась последняя отправка — для карточки сотрудника: «доставлено
    # в 14:32» или «последняя ошибка: …». Журнал хранит всё, здесь — итог.
    last_sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    # Человек заблокировал бота. Пока отметка стоит, канал не адресуется —
    # иначе каждое событие давало бы отказ и письмо «не доставлено»; снимает её
    # первое же сообщение человека боту.
    blocked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications_channel"
        ordering = ["title"]

    def __str__(self) -> str:
        return f"{self.title} ({self.type})"
