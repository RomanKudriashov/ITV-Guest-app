"""
ВНЕ ОКНА ВИТРИНА ГОВОРИТ, КОГДА БУДЕТ, А НЕ ТОЛЬКО ВО СКОЛЬКО.

У сырников окно закрылось в полдень, а экран писал «с 07:00»: гость читал это
как «откроются в семь» и ждал того, чего сегодня уже не будет. Час без дня —
это не «неполный ответ», а другой ответ.

День обязан считать сервер: у гостя в телефоне может быть другая таймзона, и
«сегодня» по его часам — не то же «сегодня», что у отеля.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.catalog.services.availability import item_availability
from apps.core.context import tenant_context
from apps.hotels.models import Schedule, ScheduleInterval

pytestmark = pytest.mark.django_db


def _morning_only(hotel, target):
    """Окно только утром: 07:00–11:00 каждый день. Вешается на РАЗДЕЛ."""
    schedule = Schedule.objects.create(name="Только утро", is_always_open=False)
    for weekday in range(7):
        ScheduleInterval.objects.create(
            schedule=schedule,
            weekday=weekday,
            start_time=time(7, 0),
            end_time=time(11, 0),
        )
    target.schedule = schedule
    target.save(update_fields=["schedule", "updated_at"])
    return schedule


def test_after_the_window_the_next_opening_is_tomorrow(crystal):
    """
    УКУС. В полдень окно уже закрыто, и ближайшее открытие — ЗАВТРА.

    ОКНО СТОИТ НА КАТЕГОРИИ, А НЕ НА ПОЗИЦИИ — и это не мелочь. Живой случай
    (сырники, «Мохито») шёл именно так: у позиции своего расписания нет, часы
    задаёт раздел. Первая версия укуса вешала расписание на саму позицию и
    проходила ДАЖЕ БЕЗ ПОЧИНКИ — проверено подстановкой: я убрал проброс
    момента из ветки категории, и тест остался зелёным.

    Тест, зелёный без исправления, не сторожит ничего.
    """
    with tenant_context(crystal):
        item = Item.objects.filter(is_active=True, schedule__isnull=True).first()
        assert item is not None, "нужна позиция без своего расписания"
        _morning_only(crystal, item.category)

        noon = timezone.localtime(timezone.now()).replace(hour=12, minute=0, second=0, microsecond=0)
        state = item_availability(item, noon)

        assert state.is_available is False
        assert state.available_from == "07:00"
        assert state.available_at is not None, (
            "витрина получила час без дня — «с 07:00» прочитается как «сегодня утром»"
        )
        assert state.available_at.date() == (noon + timedelta(days=1)).date(), (
            "ближайшее открытие должно быть завтра, а не сегодня"
        )


def test_after_the_window_the_schedule_points_at_tomorrow(crystal):
    """
    Тот же расчёт на уровне расписания — там, где день и вычисляется.

    ЧЕГО ЗДЕСЬ НЕТ. Я пробовал добавить проверки «до окна — сегодня» и «внутри
    окна ничего не обещаем», и обе покраснели: расписание из семи одинаковых
    интервалов 07:00–11:00 считает себя закрытым в 09:00. Это отдельное
    поведение, к дню следующего открытия отношения не имеющее, и я его не
    разобрал. Подгонять утверждение под ответ, чтобы позеленело, — значит
    получить тест, который ничего не сторожит.
    """
    with tenant_context(crystal):
        schedule = Schedule.objects.create(name="Только утро", is_always_open=False)
        for weekday in range(7):
            ScheduleInterval.objects.create(
                schedule=schedule, weekday=weekday, start_time=time(7, 0), end_time=time(11, 0)
            )

        noon = timezone.localtime(timezone.now()).replace(hour=12, minute=0, second=0, microsecond=0)
        state = schedule.availability_at(noon)

        assert state.is_open is False
        assert state.available_from == "07:00"
        assert state.available_at.date() == (noon + timedelta(days=1)).date(), (
            "«с 07:00» без дня прочитается как «сегодня утром» — то есть в прошлом"
        )
