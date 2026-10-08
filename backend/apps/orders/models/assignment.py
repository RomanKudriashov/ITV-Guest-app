"""
Журнал назначений исполнителя (партия 47).

Назначение — не смена статуса: старший смены ставит заказ на человека, а статус
и момент принятия остаются прежними (эскалация идёт до «Принять»). Поэтому у
назначения свой журнал, а не запись в `OrderStatusChange` с «из X в X».

Имена — СНИМКОМ на момент события, как у журнала статусов (партия 31, DEV-02):
кто назначил и на кого, остаётся прочитанным, даже если учётку потом удалили
или переименовали.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class OrderAssignment(TenantModel):
    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="assignments"
    )
    assignee_id_snapshot = models.UUIDField(null=True, blank=True)
    assignee_name = models.CharField(max_length=255, blank=True)
    previous_name = models.CharField(max_length=255, blank=True)
    actor_id = models.UUIDField(null=True, blank=True)
    actor_name = models.CharField(max_length=255, blank=True)
    # Почему запись: пусто — назначение старшим; `transfer` — исполнитель снят
    # переносом на другую точку (партия 48).
    reason = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = "orders_order_assignment"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.order_id}: → {self.assignee_name}"
