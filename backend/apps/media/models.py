"""
Медиа: оригинал живёт в MinIO, варианты нарезает Celery.

Загрузка никогда не ждёт ресайза: API сохраняет оригинал и отдаёт ассет в
статусе PENDING, дальше воркер догоняет. До готовности (и навсегда, если
картинки нет вообще) отдаётся заглушка по категории — гость не должен видеть
битую картинку в меню.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import BaseModel, TenantModel


class MediaAsset(TenantModel):
    class Kind(models.TextChoices):
        ITEM = "item", "Позиция каталога"
        CATEGORY = "category", "Категория"
        BRAND = "brand", "Брендинг"
        OTHER = "other", "Прочее"

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает обработки"
        PROCESSING = "processing", "Обрабатывается"
        READY = "ready", "Готов"
        FAILED = "failed", "Ошибка"

    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.OTHER)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)

    object_key = models.CharField(max_length=512, help_text="Ключ оригинала в бакете")
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=128, blank=True)
    size_bytes = models.BigIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)

    # {"thumb": "hotels/<id>/thumb/....webp", "card": "...", "full": "..."}
    variants = models.JSONField(default=dict, blank=True)
    alt = TranslatableField()
    error = models.TextField(blank=True)

    class Meta:
        db_table = "media_asset"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.object_key

    def url(self, variant: str = "card") -> str:
        """
        Публичный URL варианта. Фолбэк-цепочка: запрошенный вариант →
        оригинал → пусто (вызывающий подставит заглушку по категории).
        """
        key = self.variants.get(variant) or (
            self.object_key if self.status == self.Status.READY else ""
        )
        if not key:
            return ""
        scheme = "https" if settings.MINIO_SECURE else "http"
        return f"{scheme}://{settings.MINIO_PUBLIC_ENDPOINT}/{settings.MINIO_BUCKET}/{key}"


class CategoryPlaceholder(BaseModel):
    """
    Заглушка-по-категории. Платформенного уровня: один набор нейтральных
    картинок на все отели, отель может переопределить своей загрузкой.
    """

    code = models.SlugField(max_length=64, unique=True)
    title = models.CharField(max_length=128, blank=True)
    image_url = models.CharField(max_length=512, blank=True)

    class Meta:
        db_table = "media_category_placeholder"
        ordering = ["code"]

    def __str__(self) -> str:
        return self.code

    @classmethod
    def url_for(cls, code: str) -> str:
        placeholder = cls.objects.filter(code=code).first() or cls.objects.filter(
            code="default"
        ).first()
        return placeholder.image_url if placeholder else ""
