"""
Номера отеля.
"""

from __future__ import annotations

import re

from django.db import models

from apps.core.models import TenantModel

# Ширина разряда в ключе сортировки. Восьми цифр хватает любому номеру комнаты
# с запасом: 99 999 999 — это больше, чем комнат бывает у сети целиком.
_DIGITS = 8
_RUNS = re.compile(r"(\d+)")


def natural_number_key(number: str) -> str:
    """
    Ключ для ЧЕЛОВЕЧЕСКОГО порядка номеров.

    Сортировка по самой строке лексикографическая, и на реальном фонде она
    врёт: `12` встаёт после `101`, а `99` уходит в конец. Замер на нашем же
    Postgres, тот же порядок, что увидел бы администратор:

        100, 101, 101а, 12, 1201, 3A, 3А, 99, Люкс-1

    На демо-стенде дефекта не видно — там номера одной ширины (201…412,
    101…206, 01…12), и лексикографический порядок случайно совпадает с
    ожидаемым. Поэтому чиним сейчас, а не когда приедет фонд с 99 и 100.

    Правило: КАЖДАЯ группа цифр дополняется нулями слева до восьми разрядов,
    буквы приводятся к нижнему регистру. Так сравнение строк даёт числовой
    порядок внутри цифровых групп и словарный — внутри буквенных:

        «3А»      → «00000003а»
        «101»     → «00000101»
        «101а»    → «00000101а»
        «Люкс-1»  → «люкс-00000001»

    Буквенный префикс сравнивается ПЕРВЫМ, и это тоже правильно: «A101» и
    «B205» — разные корпуса, они и должны идти группами, а не вперемешку по
    числу.
    """
    parts = _RUNS.split((number or "").strip().lower())
    return "".join(part.zfill(_DIGITS) if part.isdigit() else part for part in parts)


class Room(TenantModel):
    class Source(models.TextChoices):
        MANUAL = "manual", "Заведён вручную"
        PMS = "pms", "Синхронизирован из PMS"

    number = models.CharField(max_length=32, db_index=True)
    floor = models.CharField(max_length=16, blank=True)
    zone = models.CharField(max_length=64, blank=True, help_text="Корпус, крыло, зона")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, blank=True)

    is_active = models.BooleanField(default=True)

    # Служебная колонка: по ней сортируют, её не показывают и не правят руками.
    # Считается ТОЛЬКО из `number` и только здесь — чтобы порядок не зависел от
    # того, каким путём номер попал в базу.
    sort_key = models.CharField(max_length=320, blank=True, editable=False, db_index=True)

    class Meta:
        db_table = "hotels_room"
        # Порядок по ключу, а не по номеру. `number` вторым — на случай двух
        # написаний с одинаковым ключом («3А» латиницей и кириллицей), чтобы
        # выдача была устойчивой, а не менялась от запроса к запросу.
        ordering = ["sort_key", "number"]
        constraints = [
            # УНИКАЛЕН СРЕДИ ЖИВЫХ. Безусловное ограничение означало, что
            # мягко удалённый номер держит своё имя навсегда: комнату 305
            # удалили — и завести 305 заново нельзя никогда, притом что на
            # экране её нет. Условие приводит ограничение к тому, что видит
            # пользователь.
            models.UniqueConstraint(
                fields=["hotel", "number"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_room_per_hotel",
            )
        ]

    def save(self, *args, **kwargs):
        self.sort_key = natural_number_key(self.number)
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "sort_key"}
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.number
