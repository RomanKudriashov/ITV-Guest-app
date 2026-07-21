"""
Каталог: то, что гость видит и заказывает.

Модель намеренно шире, чем нужно еде: у Category и Item есть `type`. Еда — это
type=product. Когда придут SPA, экскурсии и трансфер, они лягут в те же
таблицы с другим типом и своим набором полей в `attributes`, а не в новую
параллельную иерархию.
"""

from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class OfferingType(models.TextChoices):
    PRODUCT = "product", "Товар/блюдо"
    SERVICE = "service", "Услуга"
    EXPERIENCE = "experience", "Впечатление"


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
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

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
        if not self.is_active:
            return False
        if self.schedule_id and not self.schedule.is_open_at(moment):
            return False
        if self.parent_id:
            return self.parent.is_available_at(moment)
        return True


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

    price = models.IntegerField(default=0, help_text="В минимальных единицах (копейках)")

    # Пищевые метки (vegan, spicy, halal…) и аллергены — плоские словари-справочники,
    # намеренно без отдельных таблиц: они редко меняются и всегда читаются целиком.
    flags = ArrayField(models.SlugField(max_length=32), default=list, blank=True)
    allergens = ArrayField(models.SlugField(max_length=32), default=list, blank=True)

    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    in_stock = models.BooleanField(default=True, help_text="Стоп-лист кухни")
    attributes = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "catalog_item"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_item_code_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code

    def is_available_at(self, moment=None) -> bool:
        if not (self.is_active and self.in_stock):
            return False
        if self.schedule_id and not self.schedule.is_open_at(moment):
            return False
        return True


class ItemImage(TenantModel):
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="images")
    asset = models.ForeignKey("media.MediaAsset", on_delete=models.CASCADE, related_name="+")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_item_image"
        ordering = ["sort_order"]

    def __str__(self) -> str:
        return f"{self.item_id}#{self.sort_order}"


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
