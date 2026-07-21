"""
Каталог: то, что гость видит и заказывает.

Одни и те же таблицы обслуживают все типы предложений. Еда — `product`
(корзина, модификаторы, цена), заявка-услуга — `service_request` (форма полей,
одна заявка, маршрут в свой отдел). Различия между типами собраны в
offerings.py одной таблицей поведений, а не разбросаны условиями по коду.

Правило на будущее и обоснования — docs/offering-types.md.
"""

from __future__ import annotations

from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel

from .request_fields import FieldType


# Типы предложений и их поведения живут в offerings.py — там же собраны все
# различия между ними. Здесь только реэкспорт, чтобы модели читались привычно.
from .offerings import LocationMode, OfferingType, behaviour_for  # noqa: E402,F401


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
        # Расчёт один на всю систему — см. apps/catalog/availability.py.
        from .availability import category_availability

        return category_availability(self, moment).is_available


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
