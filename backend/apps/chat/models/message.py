"""Сообщение треда."""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .thread import ChatThread


class ChatMessage(TenantModel):
    thread = models.ForeignKey(ChatThread, on_delete=models.CASCADE, related_name="messages")
    author_type = models.CharField(max_length=16, choices=ChatThread.AuthorType.choices)
    author_id = models.UUIDField(null=True, blank=True)
    author_name = models.CharField(max_length=128, blank=True)
    body = models.TextField()
    read_by_staff_at = models.DateTimeField(null=True, blank=True)
    read_by_guest_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "chat_message"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["hotel", "thread", "created_at"])]

    def __str__(self) -> str:
        return f"{self.author_type}: {self.body[:32]}"
