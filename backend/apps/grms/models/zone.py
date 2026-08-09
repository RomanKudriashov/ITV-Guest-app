"""
Зоны номера: прихожая, спальня, санузел.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel

from .room_type import RoomType


class Zone(TenantModel):
    """
    Зона внутри номера: спальня, гостиная, ванная (ТЗ §11).

    Создаётся при необходимости. В простом номере зона одна и в интерфейсе
    не показывается.
    """

    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="zones")
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)

    # Глиф зоны: спальня — кровать, ванная — ванна. Пусто — берётся иконка вида
    # элемента. Живёт ЗДЕСЬ, а не на фронте: отличить спальню от гардеробной
    # фронт мог бы только разбором кода зоны, а код произволен на каждом
    # объекте. Неизвестный глиф на фронте падает на умолчание.
    icon = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = "grms_zone"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "code"], name="uniq_grms_zone_per_type"
            )
        ]

    def __str__(self) -> str:
        return self.code
