"""Привязка сотрудника к сервису и точке исполнения."""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .user import User


class StaffAssignment(TenantModel):
    """
    Кто какие точки исполнения обслуживает. Отсюда берётся, в какие каналы
    трекера подписывать сотрудника и кому падает уведомление о заказе.
    """

    class Level(models.TextChoices):
        MEMBER = "member", "Исполнитель"
        LEAD = "lead", "Старший смены"
        MANAGER = "manager", "Руководитель"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="assignments")
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.CASCADE, related_name="assignments"
    )
    level = models.CharField(max_length=16, choices=Level.choices, default=Level.MEMBER)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "accounts_staff_assignment"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "user", "execution_point"], name="uniq_staff_assignment"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.execution_point_id} ({self.level})"
