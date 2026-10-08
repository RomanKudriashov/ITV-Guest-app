"""
Журнал переносов заказа между точками (партия 48).

Заказ привязан к точке исполнения при создании (`Order.execution_point`). С
партии 48 старший смены может передать его на другую точку — и каждый перенос
пишется сюда: откуда, куда, кто, почему, когда и каким по счёту. Номер переноса
нужен эскалации: им расширен ключ ступеней, чтобы погашенная ступень старой
точки не держала место ступени новой.

Имена точек и автора — СНИМКОМ: перенос остаётся прочитанным, даже если точку
потом переименовали или удалили, а учётку — тоже.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class OrderTransfer(TenantModel):
    order = models.ForeignKey("orders.Order", on_delete=models.CASCADE, related_name="transfers")
    number = models.PositiveIntegerField()
    from_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    to_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    from_title = models.CharField(max_length=255, blank=True)
    to_title = models.CharField(max_length=255, blank=True)
    actor_id = models.UUIDField(null=True, blank=True)
    actor_name = models.CharField(max_length=255, blank=True)
    reason = models.CharField(max_length=255)

    class Meta:
        db_table = "orders_order_transfer"
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["order", "number"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_order_transfer_number",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.order_id}: #{self.number} {self.from_title} → {self.to_title}"
