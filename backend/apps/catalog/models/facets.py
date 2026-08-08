"""
Аллергены и диетические маркеры: справочники отеля и привязки к позиции.

Коды общие для всех отелей (vocabularies.py), отель выбирает из списка.
"""

from __future__ import annotations

from django.db import models
from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from .item import Item


class Allergen(TenantModel):
    """
    Справочник аллергенов отеля («содержит» — про безопасность). Тенант-таблица,
    а не глобальная константа: отель добавляет свои и деактивирует системные, но
    системные удалить нельзя (14 обязательных к раскрытию). Код уникален в отеле.
    """

    code = models.SlugField(max_length=64)
    title = TranslatableField()
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_allergen"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_allergen_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code

class ItemAllergen(TenantModel):
    """
    Связь позиция↔аллерген (M2M-через). Join-строки удаляем ЖЁСТКО, как
    ItemBadge: soft-delete конфликтует с unique-индексом.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="item_allergens")
    allergen = models.ForeignKey(Allergen, on_delete=models.CASCADE, related_name="item_allergens")

    class Meta:
        db_table = "catalog_item_allergen"
        ordering = ["allergen__sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "item", "allergen"], name="uniq_item_allergen")
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.allergen_id}"

class DietaryMarker(TenantModel):
    """
    Справочник диетических маркеров отеля («подходит» — про предпочтение: веган,
    без глютена, халяль). ОТДЕЛЬНО от аллергенов: в UI выглядят иначе (зелёные
    пилюли против янтарных). Тенант-словарь; системные не удаляются.
    """

    code = models.SlugField(max_length=64)
    title = TranslatableField()
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_dietary_marker"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_dietary_marker_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code

class ItemDietaryMarker(TenantModel):
    """Связь позиция↔маркер (M2M-через). Жёсткое удаление, как ItemAllergen."""

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="item_markers")
    marker = models.ForeignKey(DietaryMarker, on_delete=models.CASCADE, related_name="item_markers")

    class Meta:
        db_table = "catalog_item_dietary_marker"
        ordering = ["marker__sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "item", "marker"], name="uniq_item_marker")
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.marker_id}"
