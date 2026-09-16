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

    class Housekeeping(models.TextChoices):
        """
        Состояние уборки. Его ставит персонал — это настоящий источник, в
        отличие от занятости, которой без PMS взять негде.

        `UNKNOWN` по умолчанию и это честно: у только что заведённого номера
        состояния нет, пока горничная его не отметила. Подставлять «чисто»
        значило бы выдать догадку за факт на первом же экране.
        """

        UNKNOWN = "unknown", "Неизвестно"
        CLEAN = "clean", "Чисто"
        DIRTY = "dirty", "Грязно"
        IN_PROGRESS = "in_progress", "Убирается"

    number = models.CharField(max_length=32, db_index=True)
    floor = models.CharField(max_length=16, blank=True)
    zone = models.CharField(max_length=64, blank=True, help_text="Корпус, крыло, зона")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, blank=True)

    # ВХОД ГОСТЯ. `is_active` — это «номер пускает гостя и печатается в лист
    # QR» (`accounts.services.create_guest_session` ищет `is_active=True`), и
    # ничего больше на него вешать нельзя.
    is_active = models.BooleanField(default=True)

    category = models.ForeignKey(
        "hotels.RoomCategory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="rooms",
    )

    housekeeping = models.CharField(
        max_length=16, choices=Housekeeping.choices, default=Housekeeping.UNKNOWN
    )

    # «ВНЕ ПРОДАЖИ» — ОТДЕЛЬНЫМ ФЛАГОМ, А НЕ ЧЕРЕЗ `is_active`.
    #
    # Соблазн был: выключил — и номер «не продаётся». Но `is_active` закрывает
    # ВХОД: гость в номере на ремонте не смог бы открыть витрину, а сам номер
    # исчез бы из печатного листа QR — то есть наклейку пришлось бы печатать
    # заново при возврате в продажу. Это разные вопросы, и решаются они
    # разными полями.
    out_of_service = models.BooleanField(default=False)

    # Служебные колонки: по ним сортируют, их не показывают и не правят руками.
    # Считаются ТОЛЬКО из `number` и `floor` и только здесь — чтобы порядок не
    # зависел от того, каким путём номер попал в базу.
    sort_key = models.CharField(max_length=320, blank=True, editable=False, db_index=True)
    # Этаж — тоже строка, и «10» у него тоже меньше «9». Отдельный ключ нужен
    # там, где номера группируют по этажам.
    floor_key = models.CharField(max_length=160, blank=True, editable=False, db_index=True)

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
        self.floor_key = natural_number_key(self.floor)
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], "sort_key", "floor_key"}
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.number
