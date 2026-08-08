"""
Расписания и их интервалы: когда заведение и позиция доступны.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, time

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TenantModel


@dataclasses.dataclass(slots=True)
class ScheduleAvailability:
    """Ответ расписания витрине: открыто ли и, если нет, когда откроется."""

    is_open: bool
    available_from: str | None = None   # «07:00» в таймзоне отеля
    available_until: str | None = None
    available_at: datetime | None = None

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

    def local_moment(self, moment: datetime | None = None) -> datetime:
        hotel = self.hotel
        return hotel.to_local(moment) if moment else hotel.local_now()

    def is_open_at(self, moment: datetime | None = None) -> bool:
        if self.is_always_open:
            return True
        local = self.local_moment(moment)
        return any(interval.covers_datetime(local) for interval in self.intervals.all())

    def availability_at(self, moment: datetime | None = None) -> "ScheduleAvailability":
        """
        Не просто «открыто/закрыто», а ещё и когда откроется.

        Считать это обязан сервер: у гостя в телефоне может быть другая
        таймзона, и «с 07:00» по его часам означало бы совсем не то время.
        """
        if self.is_always_open:
            return ScheduleAvailability(is_open=True)

        local = self.local_moment(moment)
        intervals = list(self.intervals.all())
        if not intervals:
            # Расписание без интервалов — это «никогда», а не «всегда».
            return ScheduleAvailability(is_open=False)

        for interval in intervals:
            if interval.covers_datetime(local):
                return ScheduleAvailability(
                    is_open=True, available_until=interval.end_time.strftime("%H:%M")
                )

        next_start = self._next_start_after(local, intervals)
        return ScheduleAvailability(
            is_open=False,
            available_from=next_start.strftime("%H:%M") if next_start else None,
            available_at=next_start,
        )

    @staticmethod
    def _next_start_after(local: datetime, intervals: list["ScheduleInterval"]):
        """Ближайшее открытие в пределах недели. None — если расписание пустое."""
        from datetime import datetime as dt
        from datetime import timedelta

        for offset in range(8):
            day = (local + timedelta(days=offset)).date()
            weekday = (local.weekday() + offset) % 7
            candidates = sorted(
                interval.start_time for interval in intervals if interval.weekday == weekday
            )
            for start in candidates:
                moment = dt.combine(day, start, tzinfo=local.tzinfo)
                if moment > local:
                    return moment
        return None

    def day_parts_at(self, moment: datetime | None = None) -> list[str]:
        local = self.local_moment(moment)
        return [
            interval.day_part
            for interval in self.intervals.all()
            if interval.day_part and interval.covers_datetime(local)
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
        """Только по времени, без учёта дня недели. См. covers_datetime."""
        if self.start_time <= self.end_time:
            return self.start_time <= moment < self.end_time
        # Интервал через полночь (23:00–02:00): бар работает ночью.
        return moment >= self.start_time or moment < self.end_time

    def covers_datetime(self, local: datetime) -> bool:
        """
        Проверка с учётом дня недели — единственно верная для интервалов через
        полночь. «Пятница 23:00–02:00» — это ночь с пятницы на субботу, то есть
        суббота 01:00 покрывается ПЯТНИЧНЫМ интервалом, а не субботним.
        Наивная проверка «день совпал И время попало» ошибается в обе стороны.
        """
        weekday = local.weekday()
        moment = local.time()

        if self.start_time <= self.end_time:
            return weekday == self.weekday and self.start_time <= moment < self.end_time

        if weekday == self.weekday and moment >= self.start_time:
            return True
        return weekday == (self.weekday + 1) % 7 and moment < self.end_time
