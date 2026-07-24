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


class Badge(TenantModel):
    """
    Маркетинговый бейдж позиции: «Хит», «Новинка», «Выбор шефа». Отдельная
    сущность, не флаги позиции (флаги фактические — аллергены/веган/острое).
    Цвет — РОЛЬ из токенов темы, не произвольный hex: иначе бейдж, заданный под
    тёмную тему, провалит контраст в светлой. Вешается на позицию любого типа.
    """

    class ColorRole(models.TextChoices):
        ACCENT = "accent", "Акцент"
        GOLD = "gold", "Золото"
        SUCCESS = "success", "Успех"
        INFO = "info", "Инфо"

    label = TranslatableField()
    color_role = models.CharField(max_length=16, choices=ColorRole.choices, default=ColorRole.ACCENT)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Код пресета, если бейдж заведён из библиотеки (для идемпотентного сида).
    preset = models.SlugField(max_length=64, blank=True)

    class Meta:
        db_table = "catalog_badge"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"badge:{self.label_i18n or self.pk}"


class ItemBadge(TenantModel):
    """
    Назначение бейджа позиции (M2M-через). Join-строки удаляем ЖЁСТКО:
    soft-delete конфликтует с unique-индексом (удалил → назначил снова → дубль).
    Восстановление — через all_objects, как у прочих join-таблиц.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="item_badges")
    badge = models.ForeignKey(Badge, on_delete=models.CASCADE, related_name="item_badges")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_item_badge"
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "item", "badge"], name="uniq_item_badge"),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.badge_id}"


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


class SlotConfig(TenantModel):
    """
    Конфигурация бронируемой позиции (тип slot): длительность слота,
    вместимость, рабочие часы, отдел-исполнитель.

    OneToOne к Item, а не отдельная иерархия: бронь — это тот же оффер в
    каталоге, что и блюдо, просто с другим поведением. Маршрут, снапшот,
    доступность работают общим кодом.
    """

    item = models.OneToOneField(Item, on_delete=models.CASCADE, related_name="slot_config")
    duration_minutes = models.PositiveSmallIntegerField(default=60)
    # Сколько гостей помещается в один слот одновременно (кабинет на двоих).
    capacity = models.PositiveSmallIntegerField(default=1)
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.PROTECT, related_name="+"
    )
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.PROTECT, related_name="slot_configs"
    )
    # За сколько минимум до начала можно бронировать и на сколько дней вперёд.
    lead_minutes = models.PositiveSmallIntegerField(default=0)
    horizon_days = models.PositiveSmallIntegerField(default=14)

    class Meta:
        db_table = "catalog_slot_config"

    def __str__(self) -> str:
        return f"slot-config:{self.item_id}"


class SlotBooking(TenantModel):
    """
    Одна бронь слота. Связывает заказ с ресурсом и конкретным временем.

    is_active снимается при отмене заказа — это и освобождает слот. Считать
    занятость по терминальному статусу заказа было бы дороже и завязало бы
    доступность на пресет статусов отеля.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="bookings")
    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="slot_bookings"
    )
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "catalog_slot_booking"
        ordering = ["starts_at"]
        indexes = [models.Index(fields=["hotel", "item", "starts_at", "is_active"])]

    def __str__(self) -> str:
        return f"booking:{self.item_id}@{self.starts_at:%Y-%m-%d %H:%M}"
