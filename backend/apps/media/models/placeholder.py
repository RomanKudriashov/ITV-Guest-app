"""
Заглушка категории: картинка, которой подменяется отсутствующее фото.

Платформенная таблица, а не тенантная: набор общий для всех отелей.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


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
