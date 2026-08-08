"""
Тема бренда отеля: токены витрины.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class BrandTheme(TenantModel):
    """
    Токены оформления отеля. Единственный источник цвета для фронта —
    на фронте не должно быть ни одного захардкоженного значения.

    Формат tokens совпадает с BrandTokens в frontend/src/theme/tokens.ts.
    """

    name = models.CharField(max_length=128)
    is_preset = models.BooleanField(
        default=False, help_text="Пресет-заготовка, а не рабочая тема отеля"
    )
    tokens = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "hotels_brand_theme"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
