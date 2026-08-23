"""
Срок подачи считается ОТ ЗАКАЗА, а не от «сейчас».

Дефект, ради которого написан файл: `_serve_by` возвращал
`timezone.now() + eta`, то есть не срок, а бегущую полоску. Заказ, принятый
в прошлом месяце, показывал «подадут через двадцать минут», и показывал бы
это вечно.

Все проверки идут НА ДАННЫХ С ВОЗРАСТОМ — иначе дефекта не видно вовсе:
у свежего заказа `now + eta` и `created_at + eta` совпадают, и ровно поэтому
он дожил до боевого стенда, не потревожив ни один тест.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.models import Order
from apps.orders.services import OrderInput, OrderLineInput, create_order, get_order, serialize_order

pytestmark = pytest.mark.django_db


# Буфер доставки поверх приготовления: `_prep_minutes` считает
# `prep + DEFAULT_ETA_MINUTES[delivery] - 25 + 5`, то есть для доставки ровно
# `prep + 5`. Здесь он выписан явно — тест обязан знать обещанную длительность
# сам, а не спрашивать её у проверяемого кода.
DELIVERY_BUFFER = 5


def _aged_order(minutes_ago: int, *, prep: int = 20):
    """Заказ, созданный `minutes_ago` минут назад. Возвращает (заказ, момент, обещание)."""
    item = Item.objects.get(code="caesar")
    item.prep_minutes = prep
    item.save(update_fields=["prep_minutes"])
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))
    created = timezone.now() - timedelta(minutes=minutes_ago)
    Order.objects.filter(pk=order.pk).update(created_at=created)
    return get_order(order.pk), created, timedelta(minutes=prep + DELIVERY_BUFFER)


def test_serve_by_is_anchored_to_creation(crystal):
    """Срок = момент заказа + приготовление, и ничего больше."""
    with tenant_context(crystal):
        order, created, promise = _aged_order(minutes_ago=90, prep=20)
        payload = serialize_order(order)

        expected = crystal.to_local(created + promise).isoformat()
        assert payload["serve_by"] == expected


def test_serve_by_does_not_move_between_requests(crystal):
    """
    Главная проверка. Два опроса подряд обязаны дать ОДИН И ТОТ ЖЕ срок:
    именно его уползание и было дефектом.
    """
    with tenant_context(crystal):
        order, _, _promise = _aged_order(minutes_ago=45)
        first = serialize_order(get_order(order.pk))["serve_by"]
        second = serialize_order(get_order(order.pk))["serve_by"]
        assert first == second


def test_old_order_is_overdue_not_promised_twenty_more_minutes(crystal):
    """Заказ из прошлого месяца просрочен: срок в прошлом, ждать нечего."""
    with tenant_context(crystal):
        order, _, _promise = _aged_order(minutes_ago=30 * 24 * 60)  # месяц назад
        payload = serialize_order(get_order(order.pk))

        serve_by = timezone.datetime.fromisoformat(payload["serve_by"])
        assert serve_by < timezone.now(), "срок месячного заказа обязан быть в прошлом"
        # Обратный отсчёт дошёл до нуля и там остался, а не начался заново.
        assert payload["eta_minutes"] == 0


def test_eta_counts_down_as_the_order_ages(crystal):
    """
    Осталось ждать тем меньше, чем дольше заказ висит.

    Значения ТОЧНЫЕ, а не диапазоны. Округление вверх делает их
    детерминированными: пока с момента отсчёта не прошло полной минуты,
    `ceil` возвращает одно и то же число, сколько бы долей секунды ни съел
    прогон. Диапазон здесь прятал бы ровно ту ошибку, ради которой файл и
    написан, — с округлением вниз «63 <= eta <= 65» проглатывало 64 вместо
    обещанных 65.
    """
    with tenant_context(crystal):
        # prep=60 → обещано 65 минут от создания.
        fresh, _, _promise = _aged_order(minutes_ago=0, prep=60)
        assert fresh_eta(fresh) == 65

        half, _, _promise = _aged_order(minutes_ago=30, prep=60)
        assert fresh_eta(half) == 35


def fresh_eta(order) -> int:
    return serialize_order(get_order(order.pk))["eta_minutes"]


# --- Укус: что этот фикс НЕ должен был поменять ----------------------------


def test_fresh_order_promises_exactly_what_it_promised_before(crystal):
    """
    УКУС. Свежий заказ обязан обещать ровно то же, что и до правки: момент
    заказа плюс приготовление. Если бы точкой отсчёта взяли приёмку, у только
    что оформленного заказа (`accepted_at` пуст) срока не стало бы вовсе — и
    гость на экране подтверждения увидел бы пустоту вместо «подадут к 20:40».
    """
    with tenant_context(crystal):
        order, created, promise = _aged_order(minutes_ago=0, prep=25)
        payload = serialize_order(get_order(order.pk))

        assert payload["serve_by"] is not None
        promised = timezone.datetime.fromisoformat(payload["serve_by"])
        assert promised - created == promise
        # Обещание в будущем: свежий заказ не может быть просрочен.
        assert promised > timezone.now()


def test_finished_order_promises_nothing(crystal):
    """
    УКУС. У завершённого заказа срока нет и отсчёта нет: подавать больше
    нечего. Пересчёт от `created_at` не должен был воскресить срок там, где
    его намеренно не было.
    """
    from apps.orders.services import change_status, status_flows

    with tenant_context(crystal):
        order, _, _promise = _aged_order(minutes_ago=200)
        done = status_flows.terminal_status(order.status.flow)
        change_status(get_order(order.pk), to_code=done.code, actor_type="staff")

        payload = serialize_order(get_order(order.pk))
        assert payload["serve_by"] is None
        assert payload["eta_minutes"] is None


def test_requested_time_is_the_promise_as_is(crystal):
    """Заказ ко времени: момент назвал гость, пересчитывать его нечем."""
    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        requested = timezone.now() + timedelta(hours=3)
        order = create_order(
            OrderInput(
                lines=[OrderLineInput(item_id=str(item.pk))],
                timing="scheduled",
                requested_time=requested,
            )
        )
        payload = serialize_order(get_order(order.pk))
        assert payload["serve_by"] == crystal.to_local(order.requested_time).isoformat()


def test_board_and_promise_count_from_the_same_zero(crystal):
    """
    `waiting_minutes` на доске и срок подачи обязаны исходить из одного
    момента: иначе на карточке тикают двое часов с разным нулём.
    """
    from apps.orders.services.tracker import serialize_tracker_order

    with tenant_context(crystal):
        order, created, promise = _aged_order(minutes_ago=120, prep=20)
        card = serialize_tracker_order(get_order(order.pk))

        # `waiting_minutes` — ПРОШЕДШЕЕ время, и оно округляется ВНИЗ: на
        # 59-й секунде ждали ноль полных минут, а не одну. Для прошедшего это
        # верно, в отличие от остатка. Отсюда ровно 120, а не диапазон.
        assert card["waiting_minutes"] == 120
        assert card["is_overdue"] is True
        serve_by = timezone.datetime.fromisoformat(card["serve_by"])
        assert serve_by == created + promise


def test_overdue_says_by_how_much_and_from_the_point_threshold(crystal):
    """
    УКУС. Просрочка называет ВЕЛИЧИНУ, и считает её сервер.

    Красный чип без числа одинаково выглядел у опоздавшего на минуту и у
    забытого на двое суток. Вычитать порог на клиенте нельзя: `sla_minutes` —
    настройка ТОЧКИ, и второе место, где записано, что такое просрочка,
    однажды разошлось бы с первым.
    """
    from apps.orders.services.tracker import serialize_tracker_order

    with tenant_context(crystal):
        order, _, _ = _aged_order(minutes_ago=120, prep=20)
        point = order.execution_point
        card = serialize_tracker_order(get_order(order.pk))

        assert card["is_overdue"] is True
        assert card["overdue_minutes"] == 120 - point.sla_minutes


def test_an_order_in_time_has_no_overdue_amount(crystal):
    """
    Не просрочен — величины НЕТ, а не ноль. Ноль минут просрочки экран показал
    бы как «просрочен на 0 минут», то есть объявил бы поломку там, где всё в
    срок.
    """
    from apps.orders.services.tracker import serialize_tracker_order

    with tenant_context(crystal):
        order, _, _ = _aged_order(minutes_ago=1, prep=20)
        card = serialize_tracker_order(get_order(order.pk))

        assert card["is_overdue"] is False
        assert card["overdue_minutes"] is None
