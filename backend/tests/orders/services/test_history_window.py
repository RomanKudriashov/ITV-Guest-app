"""
ИСТОРИЯ ДОСКИ: без окна, по моменту закрытия, с непрерывным листанием.

Три вещи, которых история не умела:

  * заказ, созданный позавчера и закрытый минуту назад, не попадал в неё
    НИКОГДА — окно в 24 часа считалось от `created_at`. Ровно те заказы,
    которые разбирают дольше всего, из разбора и выпадали;
  * вчерашняя смена не могла посмотреть свою работу — окно сдвигалось;
  * 821 закрытый заказ не имеет `closed_at` (их закрыла команда обслуживания
    мимо журнала), и наивная сортировка по `-closed_at` ставила бы их ПЕРВЫМИ,
    а курсор на такой записи падал бы с `Cannot use None as a query value`.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services.services import change_status
from apps.orders.services import status_flows
from apps.orders.services.tracker import build_board

pytestmark = pytest.mark.django_db


def _kitchen() -> ExecutionPoint:
    return ExecutionPoint.objects.prefetch_related("services").get(code="kitchen")


def _closed_order(*, created_days_ago: int, closed_minutes_ago: int) -> Order:
    """Заказ, созданный тогда-то и закрытый тогда-то — две РАЗНЫЕ даты."""
    item = Item.objects.get(code="caesar")
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))
    change_status(order, to_code="done", actor_type="staff")
    Order.objects.filter(pk=order.pk).update(
        created_at=timezone.now() - timedelta(days=created_days_ago),
        closed_at=timezone.now() - timedelta(minutes=closed_minutes_ago),
    )
    order.refresh_from_db()
    return order


def _history(**kwargs) -> list[int]:
    board = build_board(_kitchen(), scope="history", language="ru", **kwargs)
    return [order["number"] for column in board["columns"] for order in column["orders"]]


def test_an_old_order_closed_just_now_is_in_the_history(crystal):
    """
    Главная потеря старого окна: заказ живёт дольше суток и выпадает навсегда.

    Он создан пять дней назад — под старым правилом (`created_at` за последние
    24 часа) не попал бы ни при каком раскладе, хотя закрыт минуту назад и
    именно его сейчас разбирают.
    """
    with tenant_context(crystal):
        old_but_fresh = _closed_order(created_days_ago=5, closed_minutes_ago=1)
        assert old_but_fresh.number in _history(limit=200)


def test_yesterdays_work_did_not_disappear_overnight(crystal):
    """Окна нет вовсе: смена может посмотреть, что было неделю назад."""
    with tenant_context(crystal):
        long_ago = _closed_order(created_days_ago=9, closed_minutes_ago=8 * 24 * 60)
        assert long_ago.number in _history(limit=500)


def test_orders_without_a_closing_moment_keep_their_place_in_time(crystal):
    """
    821 заказ без `closed_at` не всплывает наверх и не пропадает.

    Замер до правки: в чистой сортировке `-closed_at` Postgres ставит NULL
    первыми, и первыми пятью записями истории оказывались заказы 90526, 366,
    1102 — самые старые на стенде. Запасной ключ `COALESCE` ставит их на
    хронологическое место.
    """
    with tenant_context(crystal):
        fresh = _closed_order(created_days_ago=0, closed_minutes_ago=1)

        orphan = _closed_order(created_days_ago=30, closed_minutes_ago=1)
        Order.objects.filter(pk=orphan.pk).update(closed_at=None)

        numbers = _history(limit=500)
        assert orphan.number in numbers, "заказ без момента закрытия пропал из истории"
        assert numbers.index(fresh.number) < numbers.index(orphan.number), (
            "заказ без момента закрытия всплыл наверх вместо своего места во времени"
        )


def test_paging_by_cursor_neither_repeats_nor_skips(crystal):
    """
    Курсор обязан быть непрерывным И на записях без `closed_at`: на них старый
    курсор просто падал.
    """
    with tenant_context(crystal):
        for index in range(7):
            order = _closed_order(created_days_ago=index, closed_minutes_ago=index * 10)
            if index % 2:
                Order.objects.filter(pk=order.pk).update(closed_at=None)

        seen: list[int] = []
        cursor = None
        for _ in range(20):
            board = build_board(_kitchen(), scope="history", language="ru", limit=2, cursor=cursor)
            seen += [o["number"] for c in board["columns"] for o in c["orders"]]
            cursor = board["next_cursor"]
            if not cursor:
                break

        assert len(seen) == len(set(seen)), "листание повторило записи"
        assert set(seen) == set(_history(limit=500)), "листание потеряло записи"


def test_the_period_filter_works_on_the_closing_moment(crystal):
    """
    Период — про закрытие, а не про создание, и сужает С ОБЕИХ СТОРОН.

    Первая версия проверяла только верхнюю границу: заказ «не найден за
    прошлый месяц». Нижнюю границу она не трогала вовсе — укус «`since`
    перестал сужать» её не покраснел, то есть проверка молчала о половине
    фильтра. Теперь берутся два заказа по разные стороны границы.
    """
    with tenant_context(crystal):
        fresh = _closed_order(created_days_ago=40, closed_minutes_ago=5)
        stale = _closed_order(created_days_ago=40, closed_minutes_ago=20 * 24 * 60)

        today = timezone.now().date().isoformat()
        month_ago = (timezone.now().date() - timedelta(days=30)).isoformat()
        ten_days_ago = (timezone.now().date() - timedelta(days=10)).isoformat()

        # Нижняя граница: сегодняшний заказ есть, двадцатидневный — нет.
        since_today = _history(since=today, limit=500)
        assert fresh.number in since_today
        assert stale.number not in since_today, "`since` не сузил выборку снизу"

        # Верхняя граница: наоборот.
        until_ten = _history(since=month_ago, until=ten_days_ago, limit=500)
        assert stale.number in until_ten
        assert fresh.number not in until_ten, "`until` не сузил выборку сверху"


def test_room_and_status_filters_are_applied_by_the_server(crystal):
    """Фильтры сужают ВЫБОРКУ, а не страницу: иначе счётчик врёт."""
    with tenant_context(crystal):
        order = _closed_order(created_days_ago=0, closed_minutes_ago=1)
        # Причина теперь обязательна — см. `change_status`.
        change_status(
            order,
            to_code="cancelled",
            actor_type="staff",
            cancel_reason=Order.CancelReason.MISTAKE,
        )

        assert order.number in _history(status="cancelled", limit=500)
        assert order.number not in _history(status="done", limit=500)
        assert order.number not in _history(room="000", limit=500)


# --- Причина отмены --------------------------------------------------------


def test_cancelling_without_a_reason_is_refused(crystal):
    """
    Причина обязательна, и проверка стоит в ЕДИНСТВЕННОЙ двери в отменённый
    статус — `change_status`. Через неё идут и отмена персоналом, и отмена
    гостем, и каскад на children веерного заказа; проверка во вьюхе оставила
    бы две другие двери открытыми.

    Замер, ради которого это делается: 912 отменённых заказов на стенде и НИ
    ОДНОЙ заполненной причины — свободное необязательное поле не заполняется
    никогда.
    """
    from apps.core.errors import ValidationError

    with tenant_context(crystal):
        order = _closed_order(created_days_ago=0, closed_minutes_ago=1)
        change_status(order, to_code="preparing", actor_type="staff")

        with pytest.raises(ValidationError) as failure:
            change_status(order, to_code="cancelled", actor_type="staff")
        assert failure.value.code == "cancel_reason_required"

        order.refresh_from_db()
        assert not order.status.is_cancelled, "отказ обязан оставить заказ неотменённым"


def test_a_cancelled_order_carries_its_reason_in_all_three_places(crystal):
    """
    Причина видна ТАМ, ГДЕ ЕЁ ИЩУТ: на самом заказе (список истории), в
    карточке (код и название) и в журнале переходов (кто, когда и уточнение
    словами).
    """
    from apps.orders.services.tracker import serialize_tracker_order

    with tenant_context(crystal):
        order = _closed_order(created_days_ago=0, closed_minutes_ago=1)
        change_status(order, to_code="preparing", actor_type="staff")
        change_status(
            order,
            to_code="cancelled",
            actor_type="staff",
            comment="закончился соус",
            cancel_reason=Order.CancelReason.OUT_OF_STOCK,
        )
        order.refresh_from_db()

        # 1. На заказе — кодом, по нему считают.
        assert order.cancel_reason == Order.CancelReason.OUT_OF_STOCK

        card = serialize_tracker_order(order)
        # 2. В карточке — и кодом, и словами.
        assert card["cancel_reason"] == "out_of_stock"
        assert card["cancel_reason_title"] == "Нет в наличии"

        # 3. В журнале — уточнение и автор.
        last = card["journal"][-1]
        assert last["to"] == "cancelled"
        assert last["comment"] == "закончился соус"
        assert last["actor_type"] == "staff"


def test_a_guest_cancelling_does_not_have_to_explain_himself(crystal):
    """
    Гость причину не выбирает: он нажимает «отменить», и это само по себе
    причина. Спрашивать у него код из нашего справочника значило бы заставить
    человека объясняться перед отелем.
    """
    from apps.orders.services.services import cancel_order_by_guest

    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))

        cancel_order_by_guest(order, guest_session=None)
        order.refresh_from_db()

        assert order.status.is_cancelled
        assert order.cancel_reason == Order.CancelReason.GUEST_REFUSED


# --- Чем наполнять фильтр «Статус» -----------------------------------------


def test_history_carries_the_statuses_its_filter_can_offer(crystal):
    """
    Сужать по статусу сервер умел и раньше — выбрать его было НЕ ИЗ ЧЕГО.

    Список кодов живёт в потоке точки: у кухни он один, у хозслужбы другой.
    Поэтому он едет с доской, как и «исполнитель», а не зашивается в клиенте.
    """
    with tenant_context(crystal):
        board = build_board(_kitchen(), scope="history", language="ru")

        codes = [row["code"] for row in board["statuses"]]
        assert codes, "история пришла без списка статусов — фильтру нечем наполниться"
        assert "cancelled" in codes, "«Отменён» не предложить, а отменённые в истории есть"
        # Подпись человеческая, а не код: её показывают в выпадающем списке.
        assert all(row["title"] and row["title"] != row["code"] for row in board["statuses"])


def test_the_status_filter_offers_only_what_history_can_show(crystal):
    """
    Только терминальные. `_history_queryset` отбирает `is_terminal=True`, и
    «Готовится» в списке означал бы выборку, которая ВСЕГДА пуста.
    """
    with tenant_context(crystal):
        board = build_board(_kitchen(), scope="history", language="ru")
        offered = {row["code"] for row in board["statuses"]}

        point = _kitchen()
        flow_statuses = status_flows.statuses_for_flow(status_flows.flow_for_point(point))
        terminal = {s.code for s in flow_statuses if s.is_terminal}
        alive = {s.code for s in flow_statuses if not s.is_terminal}

        assert offered == terminal
        assert not (offered & alive), "в фильтре статус, которого в истории не бывает"


def test_the_active_board_does_not_offer_a_status_filter(crystal):
    """На активной доске статус И ЕСТЬ колонка: второй отбор по нему — второй
    ответ на тот же вопрос."""
    with tenant_context(crystal):
        board = build_board(_kitchen(), scope="active", language="ru")
        assert board["statuses"] is None
