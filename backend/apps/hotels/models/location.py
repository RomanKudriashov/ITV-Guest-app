"""
Локации доставки: куда нести заказ.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class Location(TenantModel):
    """
    Куда доставлять. Два вида: в номер и общая точка (у бассейна, лобби-бар).
    Общая точка может требовать уточнения — «шезлонг №», «столик №».
    """

    class Kind(models.TextChoices):
        IN_ROOM = "in_room", "В номер"
        COMMON_POINT = "common_point", "Общая точка"

    code = models.SlugField(max_length=64)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.IN_ROOM)
    title = TranslatableField()
    requires_refinement = models.BooleanField(default=False)
    refinement_label = TranslatableField()
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Стоимость доставки в эту локацию; 0 = бесплатно. Порог бесплатной
    # доставки — на уровне отеля.
    delivery_fee_minor = models.IntegerField(default=0)

    class Meta:
        db_table = "hotels_location"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_location_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code
