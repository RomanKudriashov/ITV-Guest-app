"""
КАТЕГОРИЯ НОМЕРА — тарифная, а не техническая.

Своя таблица на стороне `hotels`, и это решение, а не случайность. Тип номера
в системе уже есть — `grms.RoomType`, — но он про ОБОРУДОВАНИЕ: у него
опубликованный снимок конфигурации, уровень плана (платная услуга, которую
задаём мы) и шаблон имени устройства iRidi. Категория — про то, что отель
продаёт: «Стандарт», «Делюкс», «Люкс с террасой».

Почему нельзя было положить её туда же, тремя фактами из кода:

  * `RoomTypeRoom.room` — OneToOne: комната относится максимум к ОДНОМУ типу
    оборудования. Категория унаследовала бы это ограничение без всякой на то
    причины;
  * смена категории начала бы задевать публикацию конфигурации оборудования —
    два разных вопроса на одной кнопке;
  * GRMS включается тарифом. У «Азура» и «Люмена» модуль выключен: типов ноль
    при 14 и 12 комнатах, — а категории нужны им ровно так же.

Направление зависимости остаётся grms → hotels, и модуль GRMS по-прежнему
снимается целиком, не унося с собой номерной фонд.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class RoomCategory(TenantModel):
    code = models.SlugField(max_length=64)
    title = TranslatableField()

    # Порядок задаёт отель: «Стандарт, Делюкс, Люкс» — это не алфавит и не
    # дата заведения. Совпали значения — разнимает код, чтобы выдача была
    # устойчивой, а не менялась от запроса к запросу.
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_room_category"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_room_category_per_hotel",
            )
        ]

    def __str__(self) -> str:
        return self.code
