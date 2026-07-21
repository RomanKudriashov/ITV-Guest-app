"""
Заказы.

Два инварианта, ради которых всё и строилось:

  1. Снапшоты. В OrderItem лежат цена, название и модификаторы НА МОМЕНТ
     заказа. Меню меняется каждый день — история заказа меняться не должна.
  2. Резолвленный маршрут. Order.execution_point вычисляется при создании и
     дальше не пересчитывается: перенастройка Route не должна переносить
     вчерашние заказы на другую кухню.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class StatusDefinition(TenantModel):
    """
    Статусы настраиваются на отель (пресет заводится сидом), а не захардкожены:
    у ресторана «готовится → в пути», у SPA «подтверждено → оказано».
    """

    code = models.SlugField(max_length=64)
    title = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_initial = models.BooleanField(default=False)
    is_terminal = models.BooleanField(default=False)
    is_cancelled = models.BooleanField(default=False)
    # Можно ли отменить заказ, находящийся в этом статусе. Настройка отеля, а
    # не константа в коде: где-то отменяют до «Готовится», где-то до самой
    # выдачи. Гость видит кнопку ровно тогда, когда отмена действительно
    # разрешена, — иначе он жмёт её и получает отказ.
    allows_guest_cancel = models.BooleanField(default=False)
    # Имя токена темы, а не цвет: цвета живут только в токенах бренда.
    color_token = models.SlugField(max_length=64, blank=True)

    class Meta:
        db_table = "orders_status_definition"
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_status_code_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code


class Order(TenantModel):
    class Type(models.TextChoices):
        CART = "cart", "Корзина (несколько позиций)"
        REQUEST = "request", "Заявка (одно действие)"

    class DeliveryMode(models.TextChoices):
        DELIVERY = "delivery", "Доставка"
        PICKUP = "pickup", "Самовывоз"

    number = models.PositiveIntegerField(help_text="Сквозной номер в рамках отеля")
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.CART)

    guest_session = models.ForeignKey(
        "accounts.GuestSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    room = models.ForeignKey(
        "hotels.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    location = models.ForeignKey(
        "hotels.Location", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    location_refinement = models.CharField(
        max_length=128, blank=True, help_text="Шезлонг №, столик № и т.п."
    )
    delivery_mode = models.CharField(
        max_length=16, choices=DeliveryMode.choices, default=DeliveryMode.DELIVERY
    )
    requested_time = models.DateTimeField(
        null=True, blank=True, help_text="«К 19:00» — хранится в UTC, показывается в TZ отеля"
    )
    comment = models.TextField(blank=True)

    status = models.ForeignKey(
        StatusDefinition, on_delete=models.PROTECT, related_name="orders"
    )
    total = models.IntegerField(default=0, help_text="В минимальных единицах")
    currency = models.CharField(max_length=3, default="RUB")

    # Кто взял заказ в работу. Отдельным полем, а не выводом из истории
    # переходов: доска показывает исполнителя в каждой карточке, и считать его
    # каждый раз из OrderStatusChange было бы и дорого, и неоднозначно.
    assignee = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_orders",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)

    # Швы под будущее: оплату и PMS в этом прогоне не реализуем.
    payment_state = models.CharField(max_length=32, default="none")
    pms_folio_ref = models.CharField(max_length=128, blank=True)

    class Meta:
        db_table = "orders_order"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "number"], name="uniq_order_number_per_hotel"
            )
        ]
        indexes = [
            models.Index(fields=["hotel", "execution_point", "-created_at"]),
            models.Index(fields=["hotel", "status"]),
        ]

    def __str__(self) -> str:
        return f"#{self.number}"

    @property
    def realtime_group(self) -> str:
        """Канал, на который подписан гость, чтобы видеть статус своего заказа."""
        return f"order.{self.hotel_id}.{self.pk}"


class OrderItem(TenantModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    item = models.ForeignKey(
        "catalog.Item", on_delete=models.PROTECT, related_name="order_items"
    )
    quantity = models.PositiveSmallIntegerField(default=1)

    # Снапшоты: не выводить их из связанных объектов при чтении заказа.
    title_snapshot = TranslatableField()
    unit_price_snapshot = models.IntegerField(default=0)
    modifiers_snapshot = models.JSONField(default=list, blank=True)
    line_total = models.IntegerField(default=0)
    comment = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "orders_order_item"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.item_id} ×{self.quantity}"


class OrderStatusChange(TenantModel):
    """История переходов — для SLA-аналитики и разбора «кто когда взял заказ»."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_changes")
    from_status = models.ForeignKey(
        StatusDefinition, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    to_status = models.ForeignKey(
        StatusDefinition, on_delete=models.PROTECT, related_name="+"
    )
    actor_type = models.CharField(max_length=16, default="system")
    actor_id = models.UUIDField(null=True, blank=True)
    comment = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "orders_order_status_change"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.order_id}: {self.from_status_id} → {self.to_status_id}"
