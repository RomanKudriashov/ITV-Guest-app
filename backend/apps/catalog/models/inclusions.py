"""
Включения одного сервиса в другой: что показывать в агрегаторе.

Включения одного сервиса в другой: что показывать в агрегаторе.
"""

from __future__ import annotations

from django.db import models
from apps.core.models import TenantModel
from .category import Category
from .item import Item


class ServiceInclusion(TenantModel):
    """
    Включение контента одного сервиса в другой ПО ССЫЛКЕ (не копия).

    Правка позиции в источнике отражается у всех, кто её включил, — единый
    источник правды (стоп-лист тоже). Поверх заимствованного блока — overlay:
    наценка, скрытие позиций, своё расписание, выбор исполнителя. Резолв
    эффективного каталога/цены/доступности — apps/catalog/inclusions.py;
    управляющий UI — R4.
    """

    class Scope(models.TextChoices):
        ALL = "all", "Весь источник"
        CATEGORIES = "categories", "Выбранные категории"

    class MarkupKind(models.TextChoices):
        NONE = "none", "Без наценки"
        PERCENT = "percent", "Процент"
        AMOUNT = "amount", "Сумма"

    class Executor(models.TextChoices):
        SOURCE = "source", "Точка источника"
        OWN = "own", "Своя точка"

    including_service = models.ForeignKey(
        "hotels.Service", on_delete=models.CASCADE, related_name="inclusions"
    )
    source_service = models.ForeignKey(
        "hotels.Service", on_delete=models.CASCADE, related_name="inclusion_uses"
    )
    scope = models.CharField(max_length=16, choices=Scope.choices, default=Scope.ALL)
    markup_kind = models.CharField(
        max_length=16, choices=MarkupKind.choices, default=MarkupKind.NONE
    )
    # percent — в базисных пунктах (1500 = 15%); amount — в минимальных единицах.
    markup_value = models.IntegerField(default=0)
    # Своё расписание блока; null = доступность источника.
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    executor = models.CharField(
        max_length=16, choices=Executor.choices, default=Executor.SOURCE
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_service_inclusion"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "including_service", "source_service"],
                name="uniq_inclusion_per_pair",
            ),
            models.CheckConstraint(
                check=~models.Q(including_service=models.F("source_service")),
                name="inclusion_no_self",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.including_service_id} ⊃ {self.source_service_id}"

    def apply_markup(self, price: int | None) -> int | None:
        """Цена заимствованной позиции = цена источника + наценка overlay."""
        if price is None or self.markup_kind == self.MarkupKind.NONE or not self.markup_value:
            return price
        if self.markup_kind == self.MarkupKind.PERCENT:
            return price + price * int(self.markup_value) // 10000
        return price + int(self.markup_value)

class ServiceInclusionCategory(TenantModel):
    """Для scope=categories: какие категории источника включены (M2M-через)."""

    inclusion = models.ForeignKey(
        ServiceInclusion, on_delete=models.CASCADE, related_name="selected_categories"
    )
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="inclusion_selections"
    )

    class Meta:
        db_table = "catalog_service_inclusion_category"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "inclusion", "category"], name="uniq_inclusion_category"
            )
        ]

    def __str__(self) -> str:
        return f"{self.inclusion_id}:{self.category_id}"

class ServiceInclusionHidden(TenantModel):
    """Overlay-скрытие: позиции источника, скрытые в этом включении (M2M-через)."""

    inclusion = models.ForeignKey(
        ServiceInclusion, on_delete=models.CASCADE, related_name="hidden_items"
    )
    item = models.ForeignKey(
        Item, on_delete=models.CASCADE, related_name="inclusion_hidden_in"
    )

    class Meta:
        db_table = "catalog_service_inclusion_hidden"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "inclusion", "item"], name="uniq_inclusion_hidden"
            )
        ]

    def __str__(self) -> str:
        return f"{self.inclusion_id}:hide:{self.item_id}"
