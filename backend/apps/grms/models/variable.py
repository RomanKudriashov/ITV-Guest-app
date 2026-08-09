"""
Переменные оборудования: каналы команд и обратной связи.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from apps.grms.services import catalog

from .room_type import RoomType


class Variable(TenantModel):
    """
    Переменная iRidi — строка из Excel. ТЕХНИЧЕСКАЯ КАРТА, а не элемент
    интерфейса (ТЗ §8): Excel не описывает гостевой экран.

    Обязательно допускаются оба вырожденных случая:
      * команда без feedback — сцены (C_Scene_1, тега F_Scene_* на стенде нет);
      * feedback без команды — текущая температура (F_FCU_Temperature 1).
    """

    class ValueKind(models.TextChoices):
        BINARY = catalog.ValueKind.BINARY, "0/1"
        ENUM = catalog.ValueKind.ENUM, "Дискретный набор"
        RANGE = catalog.ValueKind.RANGE, "Диапазон"

    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="variables")
    key = models.SlugField(max_length=64)

    command = models.CharField(max_length=128, blank=True)  # C_*
    feedback = models.CharField(max_length=128, blank=True)  # F_*

    value_kind = models.CharField(
        max_length=16, choices=ValueKind.choices, default=ValueKind.BINARY
    )
    min_value = models.IntegerField(default=0)
    max_value = models.IntegerField(default=1)

    # Диапазон как он был в Excel («0/1», «0-3», «16-32») и исходное описание.
    # Храним сырым, потому что формат полуструктурированный и результат разбора
    # подтверждает администратор (ТЗ §9). Когда разбор ошибётся — а он ошибётся,
    # Excel по ТИП1 уже разошёлся с сервером на две группы света, — спорную
    # строку нужно будет посмотреть глазами.
    raw_range = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "grms_variable"
        ordering = ["key"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "key"], name="uniq_grms_variable_per_type"
            )
        ]

    def __str__(self) -> str:
        return self.command or self.feedback or self.key
