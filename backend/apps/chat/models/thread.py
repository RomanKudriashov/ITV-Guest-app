"""
Чат гость ↔ персонал.

Тред живёт «при комнате», а не при заявке: гость пишет «когда завтрак?» вне
привязки к заказу, и переписка должна пережить оформление и закрытие заявок.
Когда номера нет (гость по ссылке без комнаты) — тред при сессии.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ChatThread(TenantModel):
    class AuthorType(models.TextChoices):
        GUEST = "guest", "Гость"
        STAFF = "staff", "Персонал"

    room = models.ForeignKey(
        "hotels.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="chat_threads"
    )
    guest_session = models.ForeignKey(
        "accounts.GuestSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_threads",
    )
    # Кому маршрутизируется по умолчанию (ресепшн/консьерж). null — общий тред отеля.
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_threads",
    )
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "chat_thread"
        ordering = ["-last_message_at", "-created_at"]

    def __str__(self) -> str:
        return f"thread:{self.room.number if self.room_id else self.pk}"
