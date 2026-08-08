"""
Плитки главной-витрины: порядок, размер, показ.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ShowcaseTile(TenantModel):
    """
    Настройки плитки главной-витрины: размер, порядок, показ. Наложение на
    ВЫЧИСЛЯЕМЫЙ набор плиток — сами плитки строятся из данных отеля (заведения,
    категории услуг, инфо), а эта таблица лишь переопределяет их вид. Ключ
    стабилен: код точки исполнения, код группы («restaurants»/«services») или
    служебный («info», «room-control»). Строки нет — плитка берёт дефолт.
    """

    class Size(models.TextChoices):
        S = "s", "S"
        M = "m", "M"
        L = "l", "L"

    key = models.SlugField(max_length=80)
    size = models.CharField(max_length=1, choices=Size.choices, default=Size.M)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_showcase_tile"
        ordering = ["sort_order", "key"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "key"], name="uniq_showcase_tile_per_hotel")
        ]

    def __str__(self) -> str:
        return self.key
