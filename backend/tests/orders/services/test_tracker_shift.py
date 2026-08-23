"""
СВОДКА СМЕНЫ: пять чисел, которых не было.

Пустая доска ресепшена показывала «Заказов нет» — и всё. Заявок там может не
быть полсмены, и экран выглядел сломанным ровно тогда, когда всё в порядке.
Сводка отвечает на другой вопрос: сколько сделано и как быстро.

Все проверки идут НА ДАННЫХ С ВОЗРАСТОМ. У свежих заказов медиана, среднее и
любая другая свёртка совпадают, и подмена одного другим прошла бы незамеченной
— ровно так дефект и доезжает до стенда.

МОМЕНТ «СЕЙЧАС» ЗАДАЁТСЯ ЯВНО. Граница смены — полночь в таймзоне отеля, и
тест, отсчитывающий возраст от настоящего времени, ночью уводит заказы во
вчерашние сутки: первый прогон в 01:51 по Москве это и показал. Опираться на
час, в который запустили прогон, тест не имеет права.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order, OrderStatusChange
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services import status_flows
from apps.orders.services.services import change_status
from apps.orders.services.tracker_shift import shift_summary

pytestmark = pytest.mark.django_db


def _noon(hotel):
    """Полдень сегодняшних суток отеля — устойчивая точка отсчёта для проверок."""
    return hotel.local_now().replace(hour=12, minute=0, second=0, microsecond=0)


def _order(hotel, *, minutes_into_shift: int) -> Order:
    """Заказ, созданный через `minutes_into_shift` минут после полуночи отеля."""
    item = Item.objects.get(code="caesar")
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))
    start = hotel.local_now().replace(hour=0, minute=0, second=0, microsecond=0)
    Order.objects.filter(pk=order.pk).update(
        created_at=start + timedelta(minutes=minutes_into_shift)
    )
    order.refresh_from_db()
    return order


def _close(order: Order, *, took_minutes: int) -> None:
    """
    Закрыть заказ и записать в журнал, что это случилось через `took_minutes`
    после создания. Именно журнал сводка и читает — `updated_at` двигает любая
    последующая правка заказа, и мерить им длительность нельзя.
    """
    terminal = next(
        status
        for status in status_flows.statuses_for_flow(order.status.flow)
        if status.is_terminal and not status.is_cancelled
    )
    change_status(order, to_code=terminal.code, actor_type="staff")
    OrderStatusChange.objects.filter(order=order, to_status=terminal).update(
        created_at=order.created_at + timedelta(minutes=took_minutes)
    )


def _kitchen() -> ExecutionPoint:
    return ExecutionPoint.objects.prefetch_related("services").get(code="kitchen")


def test_speed_is_a_median_so_one_forgotten_order_does_not_ruin_it(crystal):
    """
    УКУС, ради которого выбрана медиана.

    На стенде среди активных висят заказы, забытые на двое суток. Четыре заказа
    по шесть минут и один на двое суток дают СРЕДНЕЕ около шести часов — цифру,
    которой смена справедливо перестаёт верить. Медиана остаётся шестью
    минутами, потому что она про типичный заказ, а он и интересует.
    """
    with tenant_context(crystal):
        point = _kitchen()
        for _ in range(4):
            _close(_order(crystal, minutes_into_shift=60), took_minutes=6)
        # Забытый: создан в ту же смену, закрыт через двое суток.
        _close(_order(crystal, minutes_into_shift=30), took_minutes=2 * 24 * 60)

        summary = shift_summary(point, hotel=crystal, now=_noon(crystal))

        assert summary["done"] == 5
        assert summary["median_minutes"] == 6, (
            "скорость посчитана средним — один забытый заказ утащил её в часы"
        )


def test_pickup_speed_is_counted_apart_from_execution(crystal):
    """
    Скорость РЕАКЦИИ и скорость ИСПОЛНЕНИЯ — разные числа.

    Медленная кухня и невнимательная смена лечатся разным, а одно число на
    двоих показало бы «всё хорошо» у смены, которая берёт заявку через полчаса
    и потом готовит за пять минут.
    """
    with tenant_context(crystal):
        point = _kitchen()
        order = _order(crystal, minutes_into_shift=60)
        Order.objects.filter(pk=order.pk).update(
            accepted_at=order.created_at + timedelta(minutes=30)
        )
        _close(order, took_minutes=35)

        summary = shift_summary(point, hotel=crystal, now=_noon(crystal))

        assert summary["median_minutes"] == 35
        assert summary["median_pickup_minutes"] == 30


def test_nothing_measured_yet_is_none_not_zero(crystal):
    """
    Нечего мерить — `None`, а не ноль. «Средняя скорость 0 минут» экран показал
    бы как «делаем мгновенно», то есть соврал бы в самую лестную сторону.
    """
    with tenant_context(crystal):
        summary = shift_summary(_kitchen(), hotel=crystal, now=_noon(crystal))

        assert summary["done"] == 0
        assert summary["median_minutes"] is None
        assert summary["median_pickup_minutes"] is None


def test_cancelled_orders_are_not_work_done(crystal):
    """Отменённый заказ в «сделано» не идёт: иначе смену хвалили бы за отказы."""
    with tenant_context(crystal):
        point = _kitchen()
        order = _order(crystal, minutes_into_shift=60)
        cancelled = next(
            status
            for status in status_flows.statuses_for_flow(order.status.flow)
            if status.is_cancelled
        )
        change_status(order, to_code=cancelled.code, actor_type="staff")

        assert shift_summary(point, hotel=crystal, now=_noon(crystal))["done"] == 0


def test_yesterdays_work_does_not_count_towards_this_shift(crystal):
    """
    Граница смены — сутки в таймзоне ОТЕЛЯ, а не «последние 24 часа». Заказ,
    закрытый вчера в 23:50, к сегодняшней смене отношения не имеет, хотя по
    скользящему окну попал бы в неё до самого вечера.
    """
    with tenant_context(crystal):
        point = _kitchen()
        order = _order(crystal, minutes_into_shift=60)
        _close(order, took_minutes=10)
        assert shift_summary(point, hotel=crystal, now=_noon(crystal))["done"] == 1

        # Отодвигаем заказ за границу суток отеля — на десять минут до полуночи.
        start = crystal.local_now().replace(hour=0, minute=0, second=0, microsecond=0)
        Order.objects.filter(pk=order.pk).update(created_at=start - timedelta(minutes=10))

        assert shift_summary(point, hotel=crystal, now=_noon(crystal))["done"] == 0


def test_current_counts_match_the_board(crystal):
    """
    `new` / `in_work` / `overdue` считаются по тем же правилам, что колонки:
    иначе доска показывала бы «новых 4» над тремя карточками, и верить
    перестали бы обеим цифрам.
    """
    from apps.orders.services.tracker import build_board

    with tenant_context(crystal):
        point = _kitchen()
        board = build_board(point, scope="active", language="ru")
        summary = board["shift"]

        on_board = {
            column["code"]: len(column["orders"]) for column in board["columns"]
        }
        initial = next(
            status.code
            for status in status_flows.statuses_for_flow(status_flows.flow_for_point(point))
            if status.is_initial
        )
        assert summary["new"] == on_board.get(initial, 0)
        assert summary["new"] + summary["in_work"] == sum(on_board.values())


def test_tile_focus_narrows_the_board_on_the_server(crystal):
    """
    УКУС. Клик по плитке сужает доску ЗАПРОСОМ, а не отсевом уже полученного:
    отсев соврал бы на первом же заказе, который не приехал.

    Сводка при этом остаётся целой — иначе, нажав «просрочено 3», человек
    увидел бы «просрочено 3 из 3» и потерял бы ощущение доли.
    """
    from apps.orders.services.tracker import build_board

    with tenant_context(crystal):
        point = _kitchen()
        _order(crystal, minutes_into_shift=1)
        whole = build_board(point, scope="active", language="ru")
        total = sum(len(column["orders"]) for column in whole["columns"])

        only_new = build_board(point, scope="active", language="ru", focus="new")
        shown = sum(len(column["orders"]) for column in only_new["columns"])

        assert shown == whole["shift"]["new"]
        assert shown <= total
        # Числа плиток не «схлопываются» под срез.
        assert only_new["shift"] == whole["shift"]


def test_an_unknown_focus_shows_the_whole_board_not_an_error(crystal):
    """Ссылка с опечаткой показывает доску целиком, а не пустой экран с отказом."""
    from apps.orders.services.tracker import build_board

    with tenant_context(crystal):
        point = _kitchen()
        _order(crystal, minutes_into_shift=1)
        whole = build_board(point, scope="active", language="ru")
        junk = build_board(point, scope="active", language="ru", focus="мусор")

        assert sum(len(c["orders"]) for c in junk["columns"]) == sum(
            len(c["orders"]) for c in whole["columns"]
        )
