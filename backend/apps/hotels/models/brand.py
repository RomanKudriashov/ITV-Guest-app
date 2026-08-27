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
    # Из какого пресета библиотеки собрана тема. ПУСТО = тема отеля своя, и
    # источника у неё нет.
    #
    # Поле пришлось завести: заведение отеля копировало токены пресета и теряло
    # его код, поэтому сравнить оформление отеля было НЕ С ЧЕМ. Это не «признак
    # тронутости» (его механизм не требует — см. `services/inheritance.py`), а
    # происхождение: без него вопрос «отель поменял наш пресет или взял свой?»
    # не имеет ответа в данных.
    source_preset = models.SlugField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "hotels_brand_theme"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
