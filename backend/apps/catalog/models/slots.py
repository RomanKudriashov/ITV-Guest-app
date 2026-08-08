"""
Брони: конфигурация окон и занятые слоты.

Брони: конфигурация окон и занятые слоты.
"""

from __future__ import annotations

from django.db import models
from apps.core.models import TenantModel
from .item import Item


class SlotConfig(TenantModel):
    """
    Конфигурация бронируемой позиции (тип slot): длительность слота,
    вместимость, рабочие часы, отдел-исполнитель.

    OneToOne к Item, а не отдельная иерархия: бронь — это тот же оффер в
    каталоге, что и блюдо, просто с другим поведением. Маршрут, снапшот,
    доступность работают общим кодом.
    """

    item = models.OneToOneField(Item, on_delete=models.CASCADE, related_name="slot_config")
    duration_minutes = models.PositiveSmallIntegerField(default=60)
    # Сколько гостей помещается в один слот одновременно (кабинет на двоих).
    capacity = models.PositiveSmallIntegerField(default=1)
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.PROTECT, related_name="+"
    )
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.PROTECT, related_name="slot_configs"
    )
    # За сколько минимум до начала можно бронировать и на сколько дней вперёд.
    lead_minutes = models.PositiveSmallIntegerField(default=0)
    horizon_days = models.PositiveSmallIntegerField(default=14)

    class Meta:
        db_table = "catalog_slot_config"

    def __str__(self) -> str:
        return f"slot-config:{self.item_id}"

class SlotBooking(TenantModel):
    """
    Одна бронь слота. Связывает заказ с ресурсом и конкретным временем.

    is_active снимается при отмене заказа — это и освобождает слот. Считать
    занятость по терминальному статусу заказа было бы дороже и завязало бы
    доступность на пресет статусов отеля.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="bookings")
    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="slot_bookings"
    )
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "catalog_slot_booking"
        ordering = ["starts_at"]
        indexes = [models.Index(fields=["hotel", "item", "starts_at", "is_active"])]

    def __str__(self) -> str:
        return f"booking:{self.item_id}@{self.starts_at:%Y-%m-%d %H:%M}"
