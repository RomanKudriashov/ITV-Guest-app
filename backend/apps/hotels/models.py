"""
Отель — корень тенанта, и всё, что описывает его физическую и организационную
структуру: бренд, языки, номера, точки исполнения, локации, расписания.

Hotel сам по себе НЕ тенант-таблица: он платформенного уровня и RLS на него не
вешается (иначе отель нельзя было бы даже найти по поддомену до того, как
установлен контекст). Изоляция отелей друг от друга обеспечивается тем, что
всё остальное ссылается на hotel_id и закрыто политиками.
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime, time

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import BaseModel, TenantModel


class Hotel(BaseModel):
    name = models.CharField(max_length=255)
    subdomain = models.SlugField(max_length=63, unique=True, db_index=True)
    # Отель может привести свой домен (menu.crystal-hotel.ru) — резолвим и по нему.
    custom_domain = models.CharField(max_length=255, blank=True, db_index=True)

    timezone = models.CharField(max_length=64, default="Europe/Moscow")
    default_language = models.CharField(max_length=8, default="en")
    currency = models.CharField(max_length=3, default="RUB")
    # Число знаков после запятой, то есть ПОКАЗАТЕЛЬ СТЕПЕНИ, а не множитель:
    # 2 → в рубле 10² = 100 копеек; 0 → в иене нет дробной части.
    # Цены везде хранятся в минимальных единицах, целыми, без float.
    currency_minor_units = models.PositiveSmallIntegerField(default=2)

    default_theme = models.ForeignKey(
        "hotels.BrandTheme",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    is_active = models.BooleanField(default=True)
    settings = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "hotels_hotel"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.subdomain})"

    @property
    def tzinfo(self) -> zoneinfo.ZoneInfo:
        try:
            return zoneinfo.ZoneInfo(self.timezone)
        except zoneinfo.ZoneInfoNotFoundError:
            return zoneinfo.ZoneInfo("UTC")

    def local_now(self) -> datetime:
        from django.utils import timezone as dj_timezone

        return dj_timezone.now().astimezone(self.tzinfo)

    def to_local(self, moment: datetime) -> datetime:
        return moment.astimezone(self.tzinfo)


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


class HotelLanguage(TenantModel):
    code = models.CharField(max_length=8)
    title = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "hotels_hotel_language"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_language_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code


class Room(TenantModel):
    class Source(models.TextChoices):
        MANUAL = "manual", "Заведён вручную"
        PMS = "pms", "Синхронизирован из PMS"

    number = models.CharField(max_length=32, db_index=True)
    floor = models.CharField(max_length=16, blank=True)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_room"
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "number"], name="uniq_room_per_hotel")
        ]

    def __str__(self) -> str:
        return self.number


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
    title = TranslatableField()
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.OTHER)
    is_active = models.BooleanField(default=True)

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


class Location(TenantModel):
    """
    Куда доставлять. Два вида: в номер и общая точка (у бассейна, лобби-бар).
    Общая точка может требовать уточнения — «шезлонг №», «столик №».
    """

    class Kind(models.TextChoices):
        IN_ROOM = "in_room", "В номер"
        COMMON_POINT = "common_point", "Общая точка"

    code = models.SlugField(max_length=64)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.IN_ROOM)
    title = TranslatableField()
    requires_refinement = models.BooleanField(default=False)
    refinement_label = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_location"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_location_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code


class Schedule(TenantModel):
    """
    Расписание доступности (категории, позиции, точки исполнения).
    Всё считается в таймзоне отеля — никаких «серверных» суток.
    """

    name = models.CharField(max_length=128)
    is_always_open = models.BooleanField(default=False)

    class Meta:
        db_table = "hotels_schedule"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def is_open_at(self, moment: datetime | None = None) -> bool:
        if self.is_always_open:
            return True

        hotel = self.hotel
        local = hotel.to_local(moment) if moment else hotel.local_now()
        weekday = local.weekday()  # 0 = понедельник
        local_time = local.time()

        for interval in self.intervals.all():
            if interval.weekday != weekday:
                continue
            if interval.covers(local_time):
                return True
        return False

    def day_parts_at(self, moment: datetime | None = None) -> list[str]:
        hotel = self.hotel
        local = hotel.to_local(moment) if moment else hotel.local_now()
        return [
            interval.day_part
            for interval in self.intervals.all()
            if interval.weekday == local.weekday()
            and interval.day_part
            and interval.covers(local.time())
        ]


class ScheduleInterval(TenantModel):
    """
    Один недельный интервал. Day-parting (завтрак/обед/ужин) — это тот же
    интервал с меткой day_part: одна сущность вместо двух похожих.
    """

    schedule = models.ForeignKey(
        Schedule, on_delete=models.CASCADE, related_name="intervals"
    )
    weekday = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        help_text="0 — понедельник, 6 — воскресенье",
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    day_part = models.SlugField(max_length=32, blank=True)

    class Meta:
        db_table = "hotels_schedule_interval"
        ordering = ["weekday", "start_time"]

    def __str__(self) -> str:
        return f"{self.weekday} {self.start_time}–{self.end_time}"

    def covers(self, moment: time) -> bool:
        if self.start_time <= self.end_time:
            return self.start_time <= moment < self.end_time
        # Интервал через полночь (23:00–02:00): бар работает ночью.
        return moment >= self.start_time or moment < self.end_time
