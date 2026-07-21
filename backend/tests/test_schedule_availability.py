"""
Доступность по расписанию — в таймзоне отеля.

Это тот расчёт, из-за которого блюдо «пропадает» из меню в 23:01. Считать его
обязан сервер: у гостя в телефоне может быть другая таймзона, и «с 07:00» по
его часам означало бы не то время.
"""

from __future__ import annotations

from datetime import datetime, time

import pytest

from apps.catalog.availability import item_availability
from apps.catalog.models import Category, Item
from apps.core.context import tenant_context
from apps.hotels.models import Hotel, Schedule, ScheduleInterval

pytestmark = pytest.mark.django_db

# Отель живёт в Москве (UTC+3). Все «часы» ниже — московские.
MOSCOW_OFFSET_HOURS = 3


def utc(year, month, day, hour, minute=0):
    from datetime import timezone as dt_timezone

    return datetime(year, month, day, hour, minute, tzinfo=dt_timezone.utc)


@pytest.fixture
def kitchen_schedule(crystal):
    with tenant_context(crystal):
        yield Schedule.objects.get(name="Кухня 07:00–23:00")


# --- Интервалы через полночь -----------------------------------------------


def test_interval_across_midnight_belongs_to_the_day_it_starts(crystal):
    """
    «Пятница 23:00–02:00» — это ночь с пятницы на субботу. Значит суббота 01:00
    покрывается ПЯТНИЧНЫМ интервалом, а суббота 23:30 — уже нет.

    Наивная проверка «день совпал И время попало в интервал» ошибается в обе
    стороны: пропускает ночь пятницы и ложно открывает ночь субботы.
    """
    with tenant_context(crystal):
        schedule = Schedule.objects.create(name="Ночной бар")
        ScheduleInterval.objects.create(
            schedule=schedule, weekday=4, start_time=time(23, 0), end_time=time(2, 0)
        )

        # 2026-07-24 — пятница. 23:30 по Москве = 20:30 UTC.
        assert schedule.is_open_at(utc(2026, 7, 24, 20, 30)) is True
        # Суббота 01:00 по Москве = пятница 22:00 UTC — всё ещё пятничная ночь.
        assert schedule.is_open_at(utc(2026, 7, 24, 22, 0)) is True
        # Суббота 03:00 по Москве — бар уже закрыт.
        assert schedule.is_open_at(utc(2026, 7, 25, 0, 0)) is False
        # Суббота 23:30 по Москве — интервала на субботу нет.
        assert schedule.is_open_at(utc(2026, 7, 25, 20, 30)) is False


def test_availability_reports_when_it_opens(crystal, kitchen_schedule):
    """Закрыто — недостаточно: гостю нужно знать, когда откроется."""
    with tenant_context(crystal):
        # 05:00 по Москве = 02:00 UTC, кухня работает с 07:00.
        state = kitchen_schedule.availability_at(utc(2026, 7, 21, 2, 0))
        assert state.is_open is False
        assert state.available_from == "07:00"

        # 12:00 по Москве — открыто, и известно, до скольки.
        state = kitchen_schedule.availability_at(utc(2026, 7, 21, 9, 0))
        assert state.is_open is True
        assert state.available_until == "23:00"


def test_next_opening_rolls_over_to_the_next_day(crystal, kitchen_schedule):
    """23:30 по Москве — ближайшее открытие уже завтра, а не сегодня."""
    with tenant_context(crystal):
        state = kitchen_schedule.availability_at(utc(2026, 7, 21, 20, 30))
        assert state.is_open is False
        assert state.available_from == "07:00"
        assert state.available_at.date().day == 22


def test_empty_schedule_means_never(crystal):
    """Расписание без интервалов — это «никогда», а не «всегда»."""
    with tenant_context(crystal):
        schedule = Schedule.objects.create(name="Пустое")
        state = schedule.availability_at(utc(2026, 7, 21, 12, 0))
        assert state.is_open is False
        assert state.available_from is None


# --- Доступность позиции ---------------------------------------------------


def test_item_inherits_category_schedule(crystal, kitchen_schedule):
    """У блюда своего расписания нет — работают часы категории."""
    with tenant_context(crystal):
        # Привязываем ограниченное расписание прямо здесь: в сиде категории
        # круглосуточны, чтобы прогон тестов не зависел от времени суток.
        Category.objects.filter(code="hot").update(schedule=kitchen_schedule)
        item = Item.objects.select_related("category__schedule").get(code="ribeye")
        assert item.schedule_id is None
        assert item.category.schedule_id is not None

        assert item_availability(item, utc(2026, 7, 21, 9, 0)).is_available is True

        night = item_availability(item, utc(2026, 7, 21, 2, 0))
        assert night.is_available is False
        assert night.reason == "schedule"
        assert night.available_from == "07:00"


def test_item_schedule_narrows_category_hours(crystal):
    """Сырники — только на завтрак: у позиции своё расписание, уже категории."""
    with tenant_context(crystal):
        syrniki = Item.objects.get(code="syrniki")

        assert item_availability(syrniki, utc(2026, 7, 21, 5, 30)).is_available is True  # 08:30 МСК

        lunch = item_availability(syrniki, utc(2026, 7, 21, 11, 0))  # 14:00 МСК
        assert lunch.is_available is False
        assert lunch.reason == "schedule"
        assert lunch.available_from == "07:00"


def test_stop_list_wins_over_schedule(crystal, kitchen_schedule):
    """
    Со стоп-листом ждать бесполезно, а часов можно дождаться — поэтому
    «нет в наличии» гостю полезнее услышать, даже если верно и то и другое.
    """
    with tenant_context(crystal):
        Category.objects.filter(code="hot").update(schedule=kitchen_schedule)
        item = Item.objects.select_related("category__schedule").get(code="ribeye")
        item.in_stock = False
        item.save(update_fields=["in_stock"])

        state = item_availability(item, utc(2026, 7, 21, 2, 0))
        assert state.is_available is False
        assert state.reason == "out_of_stock"


def test_disabled_category_hides_its_items(crystal):
    with tenant_context(crystal):
        category = Category.objects.get(code="hot")
        category.is_active = False
        category.save(update_fields=["is_active"])

        state = item_availability(Item.objects.get(code="ribeye"), utc(2026, 7, 21, 9, 0))
        assert state.is_available is False
        assert state.reason == "category_unavailable"


def test_hotel_timezone_decides_not_server_timezone(crystal, kitchen_schedule):
    """
    Один и тот же момент UTC — разный ответ для отелей в разных часовых поясах.
    Именно поэтому расчёт нельзя делать «по серверу».
    """
    moment = utc(2026, 7, 21, 3, 0)  # 06:00 МСК — кухня ещё закрыта

    with tenant_context(crystal):
        Category.objects.filter(code="hot").update(schedule=kitchen_schedule)
        item = Item.objects.select_related("category__schedule").get(code="ribeye")
        assert item_availability(item, moment).is_available is False

    Hotel.objects.filter(pk=crystal.pk).update(timezone="Asia/Novosibirsk")  # UTC+7 → 10:00
    crystal.refresh_from_db()
    with tenant_context(crystal):
        item = Item.objects.select_related("category__schedule").get(code="ribeye")
        assert item_availability(item, moment).is_available is True
