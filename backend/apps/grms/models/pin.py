"""
PIN проживания: step-up доверия для управления номером.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class RoomPin(TenantModel):
    """
    PIN проживания: подтверждение, что человек с телефоном действительно живёт
    в этом номере.

    Зачем он вообще нужен. QR висит на стене В НОМЕРЕ, и отсканировать его
    может кто угодно, кто в номер зашёл: горничная, сосед, гость предыдущего
    заезда со старым скриншотом. Смотреть на состояние — приемлемо, менять
    климат и открывать шторы — нет.

    Хранится ХЭШ, а не PIN, и хэш МЕДЛЕННЫЙ (тот же механизм, что у паролей).
    Четыре цифры перебираются мгновенно, поэтому утечка таблицы не должна
    означать перебор оффлайн; онлайн-перебор закрывает счётчик попыток.

    Живёт в `grms`, а не полем на `hotels.Room`: направление зависимости
    остаётся grms → hotels, и модуль снимается целиком, не оставляя мёртвой
    колонки в номерном фонде.
    """

    room = models.OneToOneField(
        "hotels.Room", on_delete=models.CASCADE, related_name="grms_pin"
    )
    pin_hash = models.CharField(max_length=256)

    # Конец проживания. Пусто — PIN действует, пока его не сменили: PMS-выезда
    # у нас пока неоткуда узнать, и притворяться, что мы его знаем, нельзя.
    valid_until = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "grms_room_pin"
        ordering = ["room_id"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "room"], name="uniq_grms_pin_per_room")
        ]

    def __str__(self) -> str:
        return f"pin:{self.room_id}"

    @property
    def is_active(self) -> bool:
        from django.utils import timezone as dj_timezone

        if not self.pin_hash:
            return False
        return self.valid_until is None or self.valid_until > dj_timezone.now()
