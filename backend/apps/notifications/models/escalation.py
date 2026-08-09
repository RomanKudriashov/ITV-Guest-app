"""Правило эскалации и его шаги: кого дёргать, если заявку не взяли."""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .channel import NotificationChannel
from .vocabulary import TargetKind


class EscalationRule(TenantModel):
    """
    Правило подъёма для одной точки исполнения. execution_point=NULL — правило
    по умолчанию для отеля, применяется там, где своего нет.
    """

    name = models.CharField(max_length=128)
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="escalation_rules",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "notifications_escalation_rule"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class EscalationStep(TenantModel):
    """
    Одна ступень: «через N минут → кому».

    delay_minutes считается ОТ СОЗДАНИЯ ЗАКАЗА, а не от предыдущей ступени:
    «через 15 минут» тогда означает ровно то, что написано, и перенастройка
    одной ступени не сдвигает остальные.
    """

    rule = models.ForeignKey(EscalationRule, on_delete=models.CASCADE, related_name="steps")
    sort_order = models.PositiveSmallIntegerField(default=0)
    delay_minutes = models.PositiveIntegerField(default=0)
    target_kind = models.CharField(
        max_length=32, choices=TargetKind.choices, default=TargetKind.POINT
    )
    channel = models.ForeignKey(
        NotificationChannel,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="steps",
    )
    title = models.CharField(max_length=128, blank=True)

    class Meta:
        db_table = "notifications_escalation_step"
        ordering = ["sort_order", "delay_minutes"]

    def __str__(self) -> str:
        return f"+{self.delay_minutes}м → {self.target_kind}"
