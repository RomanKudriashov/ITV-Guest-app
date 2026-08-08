"""
Модификаторы позиции и поля заявки.

Одна форма на два типа предложения: у еды это добавки, у заявки-услуги —
поля формы. Разница в поведении описана в offerings.py, не здесь.
"""

from __future__ import annotations

from django.db import models
from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from apps.catalog.request_fields import FieldType
from .item import Item


class RequestField(TenantModel):
    """
    Поле формы заявки-услуги: «Куда», «Когда подать», «Сколько человек».

    Для заявки — то же, чем ModifierGroup является для блюда: способ, которым
    гость уточняет, чего именно он хочет. Разница лишь в том, что модификатор
    меняет цену, а поле — содержание работы исполнителя.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="request_fields")
    code = models.SlugField(max_length=64)
    label = TranslatableField()
    help_text = TranslatableField()
    field_type = models.CharField(max_length=16, choices=FieldType.choices, default=FieldType.TEXT)
    is_required = models.BooleanField(default=False)
    # [{"value": "econom", "label": {"ru": "Эконом"}}] — только для select.
    options = models.JSONField(default=list, blank=True)
    min_value = models.IntegerField(null=True, blank=True)
    max_value = models.IntegerField(null=True, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_request_field"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["item", "code"], name="uniq_request_field_per_item")
        ]

    def __str__(self) -> str:
        return self.code

class ModifierGroup(TenantModel):
    """
    Группа модификаторов: «Прожарка» (обязательная, ровно один вариант),
    «Добавки» (необязательная, несколько).
    """

    class Selection(models.TextChoices):
        SINGLE = "single", "Один вариант"
        MULTI = "multi", "Несколько вариантов"

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="modifier_groups")
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    selection = models.CharField(
        max_length=16, choices=Selection.choices, default=Selection.SINGLE
    )
    is_required = models.BooleanField(default=False)
    min_choices = models.PositiveSmallIntegerField(default=0)
    max_choices = models.PositiveSmallIntegerField(default=1)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_modifier_group"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["item", "code"], name="uniq_modifier_group_per_item"
            )
        ]

    def __str__(self) -> str:
        return self.code

class ModifierOption(TenantModel):
    group = models.ForeignKey(
        ModifierGroup, on_delete=models.CASCADE, related_name="options"
    )
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    price_delta = models.IntegerField(
        default=0, help_text="Надбавка/скидка в минимальных единицах"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "catalog_modifier_option"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["group", "code"], name="uniq_modifier_option_per_group"
            )
        ]

    def __str__(self) -> str:
        return self.code
