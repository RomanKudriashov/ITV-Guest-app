"""
ЗАКРЫТОЕ ЗАВЕДЕНИЕ БЛОКИРУЕТ ЗАКАЗ.

Цепочка доступности шла позиция → раздел → родительский раздел, а часы самого
заведения в неё не входили вовсе: гость видел «Открыто до 23:00» в шапке и
спокойно заказывал в полночь. Теперь заведение — звено цепи.

Два уровня расписаний существуют ради ОБРАТНОГО случая: рум-сервис открыт
круглосуточно, а «Завтраки» внутри него — с 07:00 до 11:00. Заведение открыто,
раздел закрыт — и это по-прежнему работает.
"""

from __future__ import annotations

from datetime import time

import pytest

from apps.catalog.models import Category, Item
from apps.catalog.services.availability import (
    REASON_SCHEDULE,
    REASON_VENUE_CLOSED,
    item_availability,
)
from apps.core.context import tenant_context
from apps.hotels.models import Schedule, ScheduleInterval, Service

pytestmark = pytest.mark.django_db


def _window(hotel, name: str, start: time, end: time) -> Schedule:
    """Расписание «каждый день с … до …»."""
    schedule = Schedule.objects.create(hotel=hotel, name=name)
    for weekday in range(7):
        ScheduleInterval.objects.create(
            hotel=hotel, schedule=schedule, weekday=weekday, start_time=start, end_time=end
        )
    return schedule


def _at(hotel, hour: int):
    return hotel.local_now().replace(hour=hour, minute=0, second=0, microsecond=0)


@pytest.fixture
def kitchen_item(crystal):
    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        return item.pk


def test_closed_venue_makes_the_item_unavailable(crystal, kitchen_item):
    with tenant_context(crystal):
        item = Item.objects.get(pk=kitchen_item)
        service = item.category.service
        assert service is not None, "у раздела нет заведения — проверять нечего"

        # Заведение работает с 12:00 до 20:00, у позиции и раздела часов нет.
        service.schedule = _window(crystal, "Проверка 12–20", time(12), time(20))
        service.save(update_fields=["schedule"])
        Category.objects.filter(pk=item.category_id).update(schedule=None)
        Item.objects.filter(pk=item.pk).update(schedule=None)
        item.refresh_from_db()

        assert item_availability(item, _at(crystal, 14)).is_available is True

        closed = item_availability(item, _at(crystal, 22))
        assert closed.is_available is False
        assert closed.reason == REASON_VENUE_CLOSED
        # Время открытия — как у расписания: гость должен знать, когда вернуться.
        assert closed.available_from, "не сказано, во сколько откроется"


def test_open_venue_with_a_closed_section_still_works(crystal, kitchen_item):
    """
    ОБРАТНЫЙ СЛУЧАЙ, ради которого два уровня и заведены: заведение открыто
    круглосуточно, а раздел — только утром. Ломать его нельзя.
    """
    with tenant_context(crystal):
        item = Item.objects.get(pk=kitchen_item)
        service = item.category.service

        always = Schedule.objects.create(hotel=crystal, name="Круглосуточно", is_always_open=True)
        service.schedule = always
        service.save(update_fields=["schedule"])
        Item.objects.filter(pk=item.pk).update(schedule=None)
        Category.objects.filter(pk=item.category_id).update(
            schedule=_window(crystal, "Завтраки 07–11", time(7), time(11))
        )
        item.refresh_from_db()

        assert item_availability(item, _at(crystal, 9)).is_available is True

        closed = item_availability(item, _at(crystal, 15))
        assert closed.is_available is False
        # Причина — РАСПИСАНИЕ РАЗДЕЛА, а не заведение: оно открыто.
        assert closed.reason == REASON_SCHEDULE


def test_venue_beats_the_section_when_both_are_closed(crystal, kitchen_item):
    """
    Закрытое заведение делает более тонкие причины бессмысленными: некому
    готовить, что бы ни говорили часы раздела. Сообщать про раздел значило бы
    послать гостя ждать открытия раздела в закрытом заведении.
    """
    with tenant_context(crystal):
        item = Item.objects.get(pk=kitchen_item)
        service = item.category.service
        service.schedule = _window(crystal, "Заведение 12–20", time(12), time(20))
        service.save(update_fields=["schedule"])
        Category.objects.filter(pk=item.category_id).update(
            schedule=_window(crystal, "Раздел 07–11", time(7), time(11))
        )
        Item.objects.filter(pk=item.pk).update(schedule=None)
        item.refresh_from_db()

        state = item_availability(item, _at(crystal, 22))
        assert state.reason == REASON_VENUE_CLOSED


def test_venue_without_a_schedule_changes_nothing(crystal, kitchen_item):
    """Нет расписания у заведения — ограничений нет, как и было."""
    with tenant_context(crystal):
        item = Item.objects.get(pk=kitchen_item)
        Service.objects.filter(pk=item.category.service_id).update(schedule=None)
        Category.objects.filter(pk=item.category_id).update(schedule=None)
        Item.objects.filter(pk=item.pk).update(schedule=None)
        item.refresh_from_db()

        for hour in (3, 9, 15, 23):
            assert item_availability(item, _at(crystal, hour)).is_available is True


def test_borrowed_item_follows_the_venue_that_cooks(crystal, kitchen_item):
    """
    ЧЬИ ЧАСЫ РЕШАЮТ. Рум-сервис открыт круглосуточно и показывает блюда
    «Панорамы». Готовит их «Панорама» (`executor = SOURCE` по умолчанию) —
    значит её закрытие блюдо гасит, где бы его ни показывали.

    Проверяем сам расчёт: с явным заведением-исполнителем и без него.
    """
    with tenant_context(crystal):
        item = Item.objects.get(pk=kitchen_item)
        source = item.category.service
        source.schedule = _window(crystal, "Источник 12–20", time(12), time(20))
        source.save(update_fields=["schedule"])
        Category.objects.filter(pk=item.category_id).update(schedule=None)
        Item.objects.filter(pk=item.pk).update(schedule=None)
        item.refresh_from_db()

        # Любое ДРУГОЕ заведение в роли «готовим сами»: код рум-сервиса в сиде
        # свой у каждого отеля, и завязываться на него значит проверять сид.
        room_service = Service.objects.exclude(pk=source.pk).first()
        assert room_service is not None, "в отеле одно заведение — сравнивать не с чем"
        always = Schedule.objects.create(hotel=crystal, name="РС 24/7", is_always_open=True)
        Service.objects.filter(pk=room_service.pk).update(schedule=always)

        # Готовит источник — закрыт, значит недоступно.
        assert item_availability(item, _at(crystal, 22)).reason == REASON_VENUE_CLOSED
        # Готовит рум-сервис сам (executor=OWN) — доступно круглосуточно.
        room_service.refresh_from_db()
        assert item_availability(item, _at(crystal, 22), service=room_service).is_available is True
