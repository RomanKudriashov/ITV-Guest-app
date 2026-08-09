"""Выгрузка среза: ставится в очередь, забирается файлом."""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class AnalyticsExport(TenantModel):
    """Фоновой экспорт среза (CSV/XLSX) — считается в Celery, не в запросе."""

    class Status(models.TextChoices):
        PENDING = "pending", "В очереди"
        RUNNING = "running", "Считается"
        READY = "ready", "Готов"
        FAILED = "failed", "Ошибка"

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    export_format = models.CharField(max_length=8, default="csv")
    kind = models.CharField(max_length=32, default="breakdown")
    params = models.JSONField(default=dict, blank=True)
    # Готовый файл держим на строке: экспорт среза мал, а так download не
    # зависит от внешнего хранилища и тесты остаются герметичными.
    filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=128, blank=True)
    content = models.BinaryField(null=True, blank=True)
    row_count = models.IntegerField(default=0)
    error = models.TextField(blank=True)
    requested_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "analytics_export"
        ordering = ["-created_at"]
