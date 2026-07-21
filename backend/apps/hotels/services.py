"""
Сервисный слой расписаний.

Расписание — это то, из-за чего блюдо «пропадает» из меню в 23:01, поэтому
времена трактуются в таймзоне отеля, а не сервера. Интервал через полночь
(23:00–02:00) разрешён и означает переход на следующие сутки — бар работает
ночью, и модель обязана это уметь.
"""

from __future__ import annotations

from datetime import time
from typing import Any, Iterable

from django.db import transaction

from apps.core.errors import NotFoundError, ValidationError

from .models import Schedule, ScheduleInterval


def parse_time(value: Any, *, field: str) -> time:
    if isinstance(value, time):
        return value
    parts = str(value or "").strip().split(":")
    if len(parts) in (2, 3):
        try:
            return time(*(int(part) for part in parts))
        except (ValueError, TypeError):
            pass
    raise ValidationError(f"Некорректное время: «{value}». Ожидается ЧЧ:ММ", field=field)


def serialize_schedule(schedule: Schedule) -> dict:
    return {
        "id": str(schedule.pk),
        "name": schedule.name,
        "is_always_open": schedule.is_always_open,
        "intervals": [
            {
                "id": str(interval.pk),
                "weekday": interval.weekday,
                "start_time": interval.start_time.strftime("%H:%M"),
                "end_time": interval.end_time.strftime("%H:%M"),
                "day_part": interval.day_part,
            }
            for interval in schedule.intervals.all()
        ],
    }


def list_schedules() -> list[dict]:
    schedules = Schedule.objects.prefetch_related("intervals").order_by("name")
    return [serialize_schedule(schedule) for schedule in schedules]


def get_schedule(schedule_id) -> Schedule:
    schedule = Schedule.objects.prefetch_related("intervals").filter(pk=schedule_id).first()
    if schedule is None:
        raise NotFoundError("Расписание не найдено")
    return schedule


def _validate_intervals(intervals: Iterable[dict]) -> list[dict]:
    cleaned = []
    for index, raw in enumerate(intervals):
        weekday = raw.get("weekday")
        if weekday is None or not (0 <= int(weekday) <= 6):
            raise ValidationError(
                "День недели должен быть числом от 0 (понедельник) до 6",
                field=f"intervals.{index}.weekday",
            )
        start = parse_time(raw.get("start_time"), field=f"intervals.{index}.start_time")
        end = parse_time(raw.get("end_time"), field=f"intervals.{index}.end_time")
        if start == end:
            raise ValidationError(
                "Начало и конец интервала совпадают",
                field=f"intervals.{index}.end_time",
            )
        cleaned.append(
            {
                "weekday": int(weekday),
                "start_time": start,
                "end_time": end,
                "day_part": (raw.get("day_part") or "").strip(),
            }
        )
    return cleaned


@transaction.atomic
def create_schedule(data: dict) -> Schedule:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValidationError("Укажите название расписания", field="name")

    is_always_open = data.get("is_always_open", False)
    intervals = _validate_intervals(data.get("intervals") or [])
    if not is_always_open and not intervals:
        raise ValidationError(
            "Добавьте хотя бы один интервал или отметьте «круглосуточно»",
            field="intervals",
        )

    schedule = Schedule.objects.create(name=name, is_always_open=is_always_open)
    _replace_intervals(schedule, intervals)
    return get_schedule(schedule.pk)


@transaction.atomic
def update_schedule(schedule_id, data: dict) -> Schedule:
    schedule = get_schedule(schedule_id)

    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise ValidationError("Укажите название расписания", field="name")
        schedule.name = name
    if "is_always_open" in data:
        schedule.is_always_open = data["is_always_open"]
    schedule.save()

    if "intervals" in data:
        # Интервалы заменяются набором целиком: редактор всегда присылает
        # полную картину, а дельта-обновления породили бы рассинхрон.
        _replace_intervals(schedule, _validate_intervals(data["intervals"] or []))

    if not schedule.is_always_open and not schedule.intervals.exists():
        raise ValidationError(
            "Расписание без интервалов сделает позицию всегда недоступной",
            field="intervals",
        )
    return get_schedule(schedule.pk)


def _replace_intervals(schedule: Schedule, intervals: list[dict]) -> None:
    ScheduleInterval.objects.filter(schedule=schedule).hard_delete()
    for interval in intervals:
        ScheduleInterval.objects.create(schedule=schedule, **interval)


@transaction.atomic
def delete_schedule(schedule_id) -> None:
    from apps.catalog.models import Category, Item

    schedule = get_schedule(schedule_id)
    # Мягкое удаление не тронуло бы внешние ключи, и позиции продолжили бы
    # жить по расписанию, которого «нет». Снимаем ссылки явно: без расписания
    # позиция доступна всегда.
    Category.objects.filter(schedule=schedule).update(schedule=None)
    Item.objects.filter(schedule=schedule).update(schedule=None)
    ScheduleInterval.objects.filter(schedule=schedule).delete()
    schedule.delete()
