"""
Категория: дерево каталога.

Маршрут заказа определяется именно категорией — см. routing.py.
"""

from __future__ import annotations

from django.db import models
from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from apps.catalog.offerings import OfferingType


class Category(TenantModel):
    """Дерево категорий. Маршрут заказа определяется именно категорией (Route)."""

    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    type = models.CharField(
        max_length=32, choices=OfferingType.choices, default=OfferingType.PRODUCT
    )
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    description = TranslatableField()
    image = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Сервис-контейнер, которому принадлежит категория (её «наполнение»).
    # Проставляется из маршрута (Route.execution_point → его Service). Nullable:
    # у инфо-категории маршрута нет. Исполнение по-прежнему решает Route —
    # это лишь структурная привязка «меню внутри заведения».
    service = models.ForeignKey(
        "hotels.Service", on_delete=models.SET_NULL, null=True, blank=True, related_name="categories"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Коммерция: облагается ли категория сервисным сбором (еда — да,
    # такси — нет) и минимальная сумма заказа по категории.
    service_fee_applies = models.BooleanField(default=True)
    min_order_minor = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "catalog_category"
        ordering = ["sort_order", "code"]
        verbose_name_plural = "categories"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_category_code_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code

    def is_available_at(self, moment=None) -> bool:
        # Расчёт один на всю систему — см. apps/catalog/availability.py.
        from apps.catalog.services.availability import category_availability

        return category_availability(self, moment).is_available
