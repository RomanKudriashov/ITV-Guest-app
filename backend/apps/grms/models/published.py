"""
Опубликованная конфигурация типа номера.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .room_type import RoomType


class PublishedConfig(TenantModel):
    """
    Опубликованная версия конфигурации типа. Гость видит ТОЛЬКО её.

    payload — САМОДОСТАТОЧНЫЙ снимок: зоны, элементы, порядок, маппинг,
    диапазоны, шаблон устройства, имена команд и feedback. Он не ссылается на
    текущие Variable и ControlElement, а содержит их копию.

    Иначе удаление переменной в черновике молча сломало бы работающую
    опубликованную конфигурацию, а откат к v2 означал бы «v2 плюс сегодняшние
    правки справочников» — то есть не откат.

    Откат — публикация копии старой версии НОВЫМ номером, а не удаление новых:
    история не переписывается, иначе «почему в номере перестал работать свет»
    становится неотвечаемым вопросом.
    """

    room_type = models.ForeignKey(
        RoomType, on_delete=models.CASCADE, related_name="published_configs"
    )
    version = models.PositiveIntegerField()
    payload = models.JSONField(default=dict, blank=True)

    is_current = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.UUIDField(null=True, blank=True)

    # Заполняется у версии, созданной откатом, — на какую версию откатывались.
    rolled_back_from = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "grms_published_config"
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "version"], name="uniq_grms_config_version"
            ),
            # Текущая версия ровно одна на тип.
            models.UniqueConstraint(
                fields=["hotel", "room_type"],
                condition=models.Q(is_current=True),
                name="uniq_grms_current_config_per_type",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.room_type_id} v{self.version}{' *' if self.is_current else ''}"
