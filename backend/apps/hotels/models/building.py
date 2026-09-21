"""
КОРПУС — СПРАВОЧНИК, а не свободный текст.

Было: `Room.zone` — строка. «Главный корпус», «главный корпус», «Гл. корпус» и
«Главный  корпус» с двумя пробелами — четыре разных корпуса для фильтра и
четыре строки в выдаче, притом что здание одно. Заметить это можно только
глазами, и только если смотреть весь список сразу.

Свободный текст здесь был не ленью, а гипотезой: «корпусов может не быть».
Заказчик подтвердил обратное — корпуса реально есть, и по ним ищут номер.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class Building(TenantModel):
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    # Порядок задаёт отель: «Главный, Северный, Вилла» — не алфавит.
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_building"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_building_per_hotel",
            )
        ]

    def __str__(self) -> str:
        return self.code
