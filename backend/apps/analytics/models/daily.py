"""
Суточные витрины: заказы, позиции, модификаторы, сессии, отзывы.

Считаются пересчётом из событий — витрина, а не источник правды.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class OrderDaily(TenantModel):
    """
    Заказы по дню × измерения. Все меры атрибутируются ДАТЕ СОЗДАНИЯ заказа,
    поэтому orders_count не двоится по мере смены статуса; исход отражают
    completed/cancelled, а время — суммы+счётчики (среднее считается делением).
    """

    business_date = models.DateField(db_index=True)
    offering_type = models.CharField(max_length=32, blank=True)
    point_key = models.CharField(max_length=64, blank=True)
    location_key = models.CharField(max_length=64, blank=True)
    entry_method = models.CharField(max_length=32, blank=True)
    device = models.CharField(max_length=16, blank=True)
    language = models.CharField(max_length=8, blank=True)

    orders_count = models.IntegerField(default=0)
    # revenue_minor — выручка ПО ПОЗИЦИЯМ (subtotal). Начисления разложены
    # отдельными мерами, чтобы аналитика различала позиции/сбор/доставку/
    # налог/чаевые. Старые заказы без снимка — всё в revenue, компоненты по нулям.
    revenue_minor = models.BigIntegerField(default=0)
    service_fee_minor = models.BigIntegerField(default=0)
    delivery_minor = models.BigIntegerField(default=0)
    tax_minor = models.BigIntegerField(default=0)
    tip_minor = models.BigIntegerField(default=0)
    items_count = models.IntegerField(default=0)
    cancelled_count = models.IntegerField(default=0)
    completed_count = models.IntegerField(default=0)
    off_hours_count = models.IntegerField(default=0)
    reaction_seconds_sum = models.BigIntegerField(default=0)
    reaction_count = models.IntegerField(default=0)
    fulfil_seconds_sum = models.BigIntegerField(default=0)
    fulfil_count = models.IntegerField(default=0)

    class Meta:
        db_table = "analytics_order_daily"
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "hotel", "business_date", "offering_type", "point_key",
                    "location_key", "entry_method", "device", "language",
                ],
                name="uniq_order_daily",
            )
        ]
        indexes = [models.Index(fields=["hotel", "business_date"])]


class ItemDaily(TenantModel):
    """Спрос по позициям: топ/аутсайдеры, разбивка по категории/типу."""

    business_date = models.DateField(db_index=True)
    item_key = models.CharField(max_length=64)
    category_key = models.CharField(max_length=64, blank=True)
    offering_type = models.CharField(max_length=32, blank=True)
    # Точка заказа — чтобы старший точки видел спрос только своей точки.
    point_key = models.CharField(max_length=64, blank=True)

    quantity = models.IntegerField(default=0)
    revenue_minor = models.BigIntegerField(default=0)
    orders_count = models.IntegerField(default=0)

    class Meta:
        db_table = "analytics_item_daily"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "business_date", "item_key", "point_key"],
                name="uniq_item_daily",
            )
        ]
        indexes = [models.Index(fields=["hotel", "business_date"])]


class ModifierDaily(TenantModel):
    """Популярные модификаторы (по коду опции)."""

    business_date = models.DateField(db_index=True)
    modifier_key = models.CharField(max_length=128)
    point_key = models.CharField(max_length=64, blank=True)

    quantity = models.IntegerField(default=0)

    class Meta:
        db_table = "analytics_modifier_daily"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "business_date", "modifier_key", "point_key"],
                name="uniq_modifier_daily",
            )
        ]


class SessionDaily(TenantModel):
    """Трафик и конверсия: сессии по источнику/устройству/языку."""

    business_date = models.DateField(db_index=True)
    entry_method = models.CharField(max_length=32, blank=True)
    device = models.CharField(max_length=16, blank=True)
    language = models.CharField(max_length=8, blank=True)

    sessions_count = models.IntegerField(default=0)
    # Сессия, оформившая ≥1 заказ. Считается один раз (натуральный ключ
    # order_conversion:<session_id>), атрибутируется дате старта сессии.
    converted_count = models.IntegerField(default=0)

    class Meta:
        db_table = "analytics_session_daily"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "business_date", "entry_method", "device", "language"],
                name="uniq_session_daily",
            )
        ]


class ReviewDaily(TenantModel):
    """Отзывы: средняя оценка, доля низких, динамика."""

    business_date = models.DateField(db_index=True)
    point_key = models.CharField(max_length=64, blank=True)
    offering_type = models.CharField(max_length=32, blank=True)

    reviews_count = models.IntegerField(default=0)
    rating_sum = models.IntegerField(default=0)
    low_count = models.IntegerField(default=0)

    class Meta:
        db_table = "analytics_review_daily"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "business_date", "point_key", "offering_type"],
                name="uniq_review_daily",
            )
        ]
