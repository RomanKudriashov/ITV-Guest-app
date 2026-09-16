"""
Локации: куда нести заказ — или откуда его заберут.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class Location(TenantModel):
    """
    Место в отеле, где гость получает заказ. Три вида:

      * в номер — несут в номер гостя;
      * общая точка — несут туда (у бассейна, лобби); может требовать
        уточнения — «шезлонг №», «столик №»;
      * точка выдачи — гость забирает сам (стойка бара, окно кухни).

    СПОСОБ ПОЛУЧЕНИЯ СЛЕДУЕТ ИЗ ВИДА, а не выбирается рядом с ним: выбрал
    стойку бара — значит заберёт у стойки. У точки выдачи нет ни платы за
    доставку, ни уточнения места: нести некуда, гость подходит сам.

    Точка выдачи НЕ принадлежит отделу: у стойки бара могут выдавать и кофе,
    и выпечку кухни. Что где выдают, решает матрица «категория × локация».
    """

    class Kind(models.TextChoices):
        IN_ROOM = "in_room", "В номер"
        COMMON_POINT = "common_point", "Общая точка"
        PICKUP_POINT = "pickup_point", "Точка выдачи"

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

    @property
    def is_pickup(self) -> bool:
        return self.kind == self.Kind.PICKUP_POINT
