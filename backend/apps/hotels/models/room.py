"""
Номера отеля.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class Room(TenantModel):
    class Source(models.TextChoices):
        MANUAL = "manual", "Заведён вручную"
        PMS = "pms", "Синхронизирован из PMS"

    number = models.CharField(max_length=32, db_index=True)
    floor = models.CharField(max_length=16, blank=True)
    zone = models.CharField(max_length=64, blank=True, help_text="Корпус, крыло, зона")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_room"
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "number"], name="uniq_room_per_hotel")
        ]

    def __str__(self) -> str:
        return self.number
