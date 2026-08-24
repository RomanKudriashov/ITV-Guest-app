"""
Точки исполнения: кто физически выполняет заказ.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class ExecutionPoint(TenantModel):
    """
    Точка исполнения — кто физически выполняет заявку: кухня, бар, SPA,
    хозслужба. На неё маршрутизируются заказы (Route) и назначается персонал
    (StaffAssignment); её канал слушает трекер по WebSocket.
    """

    class Kind(models.TextChoices):
        KITCHEN = "kitchen", "Кухня"
        BAR = "bar", "Бар"
        HOUSEKEEPING = "housekeeping", "Хозслужба"
        SPA = "spa", "SPA"
        RECEPTION = "reception", "Ресепшен"
        OTHER = "other", "Прочее"

    code = models.SlugField(max_length=64)
    # Служебное название — его видят только персонал, трекер, эскалации,
    # аналитика. Гостю оно не показывается. Гостевая идентичность (public_name,
    # tagline, фото, is_guest_facing) и венью-часы (schedule) переехали на
    # Service — точка исполнения теперь чистый исполнитель.
    title = TranslatableField()
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.OTHER)
    is_active = models.BooleanField(default=True)
    # Через сколько минут ожидания заказ на доске считается просроченным.
    #
    # NULL — «не задавали, берите умолчание вида работы». Это ЗАПИСАННОЕ
    # НАМЕРЕНИЕ, а не догадка: раньше у поля было значение по умолчанию, и
    # «оператор выбрал двадцать минут» ничем не отличалось от «поле никто не
    # трогал». Код вынужден был принимать модельное умолчание за «не трогали» —
    # и ошибался ровно у тех, кто осознанно выбрал двадцать.
    #
    # Читать напрямую НЕЛЬЗЯ: единственный правильный ответ даёт
    # `tracker_types.effective_sla_minutes(point)` — его же спрашивают карточка,
    # фильтр, плитка сводки и подпись под доской.
    sla_minutes = models.PositiveSmallIntegerField(null=True, blank=True, default=None)

    class Meta:
        db_table = "hotels_execution_point"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_execution_point_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code

    @property
    def realtime_group(self) -> str:
        """Имя группы Channels, в которую летят события трекера."""
        return f"tracker.{self.hotel_id}.{self.pk}"
