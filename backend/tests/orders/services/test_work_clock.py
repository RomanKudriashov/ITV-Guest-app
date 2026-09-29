"""
ОТСЧЁТ НОРМЫ ВРЕМЕНИ — ОТ ВРЕМЕНИ, НАЗВАННОГО ГОСТЕМ (партия 22).

Заявка, созданная в 10:15 «забрать в 12:00», до 12:00 опоздать не может. До
партии 22 просрочку считали от создания все четыре читателя: карточка доски,
фильтр «просроченные», счётчик пульта и кубик номера — доска красила такую
заявку через норму после оформления. Здесь все четверо спрашиваются об одних
и тех же заказах и обязаны ответить одинаково.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.models import Order
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services.tracker_types import effective_sla_minutes

pytestmark = pytest.mark.django_db


def _session():
    from apps.accounts.services import create_guest_session

    return create_guest_session(room_number="305", language="ru").session


def _order(*, age: timedelta, requested_in: timedelta | None) -> Order:
    item = Item.objects.get(code="caesar")
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]), guest_session=_session())
    now = timezone.now()
    Order.objects.filter(pk=order.pk).update(
        created_at=now - age,
        requested_time=(now + requested_in) if requested_in is not None else None,
    )
    return Order.objects.select_related("status", "execution_point", "room").get(pk=order.pk)


def _readers(order: Order) -> dict[str, bool]:
    """Четыре ответа на вопрос «просрочен ли заказ»."""
    from apps.hotels.services.admin_services import _active_orders_by_room
    from apps.orders.services import tracker
    from apps.orders.services.tracker_shift import shift_summary_for

    point = order.execution_point
    card = tracker.serialize_tracker_order(order, "ru")["is_overdue"]
    filtered = tracker._narrow(Order.objects.filter(pk=order.pk), point, overdue=True).exists()
    # Пульт и кубик считают по точке и номеру целиком: чужие заказы теста
    # убираем (транзакция теста откатится), чтобы счёт был ровно об этом.
    Order.objects.exclude(pk=order.pk).delete()
    shift = shift_summary_for([point], hotel=order.hotel)["overdue"]
    room = _active_orders_by_room([order.room_id]).get(order.room_id, {}).get("overdue", 0)
    return {"card": card, "filter": filtered, "shift": shift == 1, "room": room == 1}


def test_request_for_later_is_not_overdue_before_its_time(crystal):
    """Создана шесть часов назад, срок — через час: не просрочена ни у кого."""
    with tenant_context(crystal):
        order = _order(age=timedelta(hours=6), requested_in=timedelta(hours=1))
        assert effective_sla_minutes(order.execution_point) < 6 * 60, "проверка пуста"
        assert _readers(order) == {"card": False, "filter": False, "shift": False, "room": False}


def test_same_age_without_a_named_time_is_overdue_everywhere(crystal):
    """Контроль: без названного времени тот же возраст — просрочка у всех четверых."""
    with tenant_context(crystal):
        order = _order(age=timedelta(hours=6), requested_in=None)
        # Проверка не пуста: порог точки меньше возраста заказа.
        assert effective_sla_minutes(order.execution_point) < 6 * 60
        assert _readers(order) == {"card": True, "filter": True, "shift": True, "room": True}


def test_named_time_passed_long_ago_is_overdue_everywhere(crystal):
    """Срок наступил и норма после него вышла — просрочка, и снова у всех."""
    with tenant_context(crystal):
        probe = _order(age=timedelta(0), requested_in=None)
        sla = effective_sla_minutes(probe.execution_point)
        probe.delete()
        order = _order(age=timedelta(hours=8), requested_in=-timedelta(minutes=sla + 30))
        assert _readers(order) == {"card": True, "filter": True, "shift": True, "room": True}
