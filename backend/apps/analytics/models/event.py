"""
Аналитические таблицы: сырой журнал событий + дневные предагрегаты.

Разделение принципиальное:

* `AnalyticsEvent` — append-only журнал. Дедуп по `dedupe_key` (натуральный
  ключ факта, а не id доставки), поэтому повтор события не двоит счётчик, а
  пересчёт читает именно его.
* `*Daily` — дневные роллапы, которые читает дашборд. Их наполняет редьюсер,
  и только он: инкременты идут по денормализованному слепку сырой строки,
  не по живым заказам. Отсюда — равенство «живая агрегация == пересчёт».

Все таблицы — тенантные (автоскоуп + RLS). Ключи-измерения хранятся строками
(str(uuid) или '' для «нет значения»): пустая строка — значение, поэтому
уникальные ограничения и upsert работают, в отличие от NULL.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


















class AnalyticsEvent(TenantModel):
    """Сырой факт аналитики. Источник истины для пересчёта."""

    # Натуральный ключ факта: order_created:<id>, order_item:<line_id>, ...
    # Именно он гарантирует идемпотентность, а не id доставки шины.
    dedupe_key = models.CharField(max_length=255)
    bus_event_id = models.UUIDField(null=True, blank=True)
    # Ветка редьюсера. НЕ имя события шины — раскладка «одно бизнес-событие →
    # несколько фактов» (создание заказа = order_created + N order_item + ...).
    kind = models.CharField(max_length=32, db_index=True)
    name = models.CharField(max_length=64, blank=True)
    occurred_at = models.DateTimeField()
    # Сутки ОТЕЛЯ, не UTC. Считаются один раз при записи и больше не пересчитываются.
    business_date = models.DateField(db_index=True)
    order_id = models.UUIDField(null=True, blank=True)
    subject_id = models.UUIDField(null=True, blank=True)
    dimensions = models.JSONField(default=dict, blank=True)
    measures = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "analytics_event"
        ordering = ["occurred_at", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "dedupe_key"], name="uniq_analytics_event"
            )
        ]
        indexes = [
            models.Index(fields=["hotel", "business_date", "kind"]),
        ]
