"""Журнал отправок: что ушло, куда и чем кончилось."""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .escalation import EscalationRule, EscalationStep

from .channel import NotificationChannel
from .vocabulary import NotificationStatus


class NotificationLog(TenantModel):
    """
    Журнал и одновременно состояние движка.

    Родительская запись (channel=NULL) — «ступень сработала»; дочерние — по
    одной на канал, «сообщение ушло». Так видно и то, что ступень отработала,
    и куда именно она разошлась.

    dedupe_key с уникальным индексом — то, чем обеспечена идемпотентность:
    повтор Celery-задачи не приводит ко второму сообщению.
    """

    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="notifications"
    )
    rule = models.ForeignKey(
        EscalationRule, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    step = models.ForeignKey(
        EscalationStep, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    channel = models.ForeignKey(
        NotificationChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="deliveries"
    )

    step_index = models.PositiveSmallIntegerField(default=0)
    target_kind = models.CharField(max_length=32, blank=True)
    status = models.CharField(
        max_length=16, choices=NotificationStatus.choices, default=NotificationStatus.SCHEDULED
    )

    scheduled_for = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True)

    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)

    dedupe_key = models.CharField(max_length=255)
    celery_task_id = models.CharField(max_length=128, blank=True)
    # Было ли заказ уже принят в момент срабатывания ступени — для разбора
    # «почему не эскалировали».
    accepted_at_send = models.BooleanField(default=False)

    class Meta:
        db_table = "notifications_log"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "dedupe_key"], name="uniq_notification_dedupe_per_hotel"
            )
        ]
        indexes = [
            models.Index(fields=["hotel", "order", "-created_at"]),
            models.Index(fields=["hotel", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.dedupe_key} [{self.status}]"
