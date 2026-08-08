"""
Куда уходит заказ: исполнитель категории и доступные локации сервиса.

Маршрутизация отделена от самой категории: одна категория может
исполняться разными точками, и это отношение, а не поле.
"""

from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models
from apps.core.models import TenantModel
from .category import Category


class Route(TenantModel):
    """
    Маршрутизация: категория → точка исполнения. Заказ резолвит маршрут в
    момент создания и запоминает результат в Order.execution_point — чтобы
    позднее изменение настроек не переписывало историю.
    """

    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="routes")
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.CASCADE, related_name="routes"
    )
    priority = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "catalog_route"
        ordering = ["priority"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "category", "execution_point"], name="uniq_route"
            )
        ]

    def __str__(self) -> str:
        return f"{self.category_id} → {self.execution_point_id}"

class ServiceLocation(TenantModel):
    """
    Матрица «категория × локация»: где эта категория доступна и какими
    способами доставки. Ресторан доставляет в номер и к бассейну, но не в
    конференц-зал; бар — только самовывоз у стойки.
    """

    class DeliveryMode(models.TextChoices):
        DELIVERY = "delivery", "Доставка"
        PICKUP = "pickup", "Самовывоз"

    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="service_locations"
    )
    location = models.ForeignKey(
        "hotels.Location", on_delete=models.CASCADE, related_name="service_locations"
    )
    delivery_modes = ArrayField(
        models.CharField(max_length=16, choices=DeliveryMode.choices),
        default=list,
        blank=True,
    )
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "catalog_service_location"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "category", "location"], name="uniq_service_location"
            )
        ]

    def __str__(self) -> str:
        return f"{self.category_id}@{self.location_id}"
