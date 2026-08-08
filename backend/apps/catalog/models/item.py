"""
Позиция каталога и всё, что описывает её саму.

Фото, характеристики и справочные привязки живут рядом с позицией:
они читаются и пишутся только вместе с ней.
"""

from __future__ import annotations

from django.db import models
from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from apps.catalog.offerings import LocationMode, OfferingType
from .category import Category


class Item(TenantModel):
    """
    Позиция каталога. Цена — в минимальных единицах валюты отеля (копейках):
    целое число, никаких Decimal-ловушек при округлении и никакого float.
    """

    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="items")
    type = models.CharField(
        max_length=32, choices=OfferingType.choices, default=OfferingType.PRODUCT
    )
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    description = TranslatableField()
    # Тело инфо-страницы (тип info). Форматированный текст {lang}; пусто у
    # остальных типов. Рендер — на клиенте.
    content = TranslatableField()

    # null — «цена не указана» (у уборки её нет), а не «бесплатно».
    price = models.IntegerField(
        null=True, blank=True, default=0, help_text="В минимальных единицах (копейках)"
    )
    location_mode = models.CharField(
        max_length=16,
        choices=LocationMode.choices,
        default=LocationMode.DELIVERY,
        help_text="Спрашивать ли у гостя локацию доставки",
    )

    # Аллергены/маркеры/характеристики позиции живут в тенант-словарях и join'ах
    # (Allergen/DietaryMarker/ItemCharacteristic), маркетинг — в Badge. Легаси
    # flags/allergens удалены в C5 после бэкфилла (миграция catalog.0007→0008).

    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    in_stock = models.BooleanField(default=True, help_text="Стоп-лист кухни")
    attributes = models.JSONField(default=dict, blank=True)
    # Время приготовления/подачи, мин: чип в карточке + слагаемое ETA.
    prep_minutes = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "catalog_item"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_item_code_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code

    def is_available_at(self, moment=None) -> bool:
        from .availability import item_availability

        return item_availability(self, moment).is_available

    def availability_at(self, moment=None):
        from .availability import item_availability

        return item_availability(self, moment)

class ItemImage(TenantModel):
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="images")
    asset = models.ForeignKey("media.MediaAsset", on_delete=models.CASCADE, related_name="+")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_item_image"
        ordering = ["sort_order"]

    def __str__(self) -> str:
        return f"{self.item_id}#{self.sort_order}"

class ItemCharacteristic(TenantModel):
    """
    Характеристика позиции: пара «переводимое название → переводимое значение» с
    порядком. «Способ приготовления → Гриль», «Вкус → Острое». Отель добавляет
    свои строки, не прося новых колонок. Порция/КБЖУ/время подачи — это поля
    позиции (attributes.nutrition/prep_minutes), сюда их не дублируем.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="characteristics")
    name = TranslatableField()
    value = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_item_characteristic"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.item_id}#{self.sort_order}"
