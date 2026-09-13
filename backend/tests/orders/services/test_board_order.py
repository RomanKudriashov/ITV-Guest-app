"""
РУЧНОЙ ПОРЯДОК НА ДОСКЕ.

Порядок по времени создания описывал не работу, а её регистрацию: смена сама
решает, что делать раньше — заказ на восемь порций в конференц-зал или кофе,
который придёт через минуту. До этой партии это решение жило только в голове у
того, кто стоит у доски, и терялось при первом обновлении экрана.

Проверки сравнивают ПОЛНЫЕ СПИСКИ номеров, а не «карточка на месте N»: список
из одного совпавшего элемента ничего не доказывает, а перепутанный порядок
соседей — именно то, чем этот механизм ломается.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services.services import change_status
from apps.orders.services.tracker import build_board, move_position

pytestmark = pytest.mark.django_db


@pytest.fixture
def chef(crystal):
    """Повар кухни — тот, кто и переставляет карточки на доске."""
    from apps.accounts.models import User

    with tenant_context(crystal):
        return User.objects.get(email=f"chef@{crystal.subdomain}.local")


def _order() -> Order:
    item = Item.objects.get(code="caesar")
    return create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))


def _kitchen() -> ExecutionPoint:
    return ExecutionPoint.objects.prefetch_related("services").get(code="kitchen")


def _column(code: str) -> list[int]:
    board = build_board(_kitchen(), scope="active", language="ru")
    column = next(c for c in board["columns"] if c["code"] == code)
    return [order["number"] for order in column["orders"]]


def test_a_new_order_lands_on_top_of_its_column(crystal, chef):
    """Невзятая заявка внизу списка будет замечена последней — значит наверх."""
    with tenant_context(crystal):
        first = _order()
        second = _order()
        third = _order()

        assert _column("new") == [third.number, second.number, first.number]


def test_moving_a_card_forward_puts_it_at_the_tail_not_into_someone_elses_queue(
    crystal, chef
):
    with tenant_context(crystal):
        early = _order()
        late = _order()
        # «Поздний» лежит выше «раннего» — он новее. Двигаем обоих дальше по
        # потоку, первым — «поздний».
        change_status(late, to_code="accepted", actor_type="staff")
        change_status(early, to_code="accepted", actor_type="staff")

        assert _column("accepted") == [late.number, early.number], (
            "в целевой колонке порядок задан тем, кого двинули раньше, "
            "а не тем, кого раньше создали"
        )


def test_a_hand_placed_card_stays_where_it_was_put(crystal, chef):
    with tenant_context(crystal):
        bottom = _order()
        middle = _order()
        top = _order()
        assert _column("new") == [top.number, middle.number, bottom.number]

        # Нижнюю — между верхней и средней.
        move_position(chef, str(bottom.pk), after_id=str(top.pk), before_id=str(middle.pk))
        assert _column("new") == [top.number, bottom.number, middle.number]

        # И в самый верх.
        move_position(chef, str(middle.pk), after_id=None, before_id=str(top.pk))
        assert _column("new") == [middle.number, top.number, bottom.number]


def test_the_order_survives_a_reread_of_the_board(crystal, chef):
    """Порядок общий и хранимый, а не украшение одного экрана."""
    with tenant_context(crystal):
        lower = _order()
        upper = _order()
        move_position(chef, str(upper.pk), after_id=str(lower.pk), before_id=None)

        first_read = _column("new")
        second_read = _column("new")
        assert first_read == [lower.number, upper.number]
        assert second_read == first_read


def test_a_neighbour_from_another_column_is_refused(crystal, chef):
    """
    «Между этими двумя» бессмысленно, если соседи из разных очередей: карточка
    получила бы число из чужой колонки и легла бы в своей неизвестно куда.
    """
    with tenant_context(crystal):
        here = _order()
        elsewhere = _order()
        change_status(elsewhere, to_code="accepted", actor_type="staff")

        with pytest.raises(ValidationError) as failure:
            move_position(chef, str(here.pk), after_id=str(elsewhere.pk), before_id=None)
        assert failure.value.code == "neighbour_not_in_column"


def test_being_overdue_colours_the_card_but_never_moves_it(crystal, chef):
    """
    Просрочка — это цвет, а не место.

    Переставлять просроченное наверх значило бы отменять решение смены о
    порядке ровно в тот момент, когда оно важнее всего: под нагрузкой.
    """
    from datetime import timedelta

    from django.utils import timezone

    with tenant_context(crystal):
        fresh = _order()
        stale = _order()
        # Просроченным делаем НИЖНИЙ — если просрочка переставляет, он всплывёт.
        Order.objects.filter(pk=fresh.pk).update(
            created_at=timezone.now() - timedelta(hours=6)
        )

        board = build_board(_kitchen(), scope="active", language="ru")
        column = next(c for c in board["columns"] if c["code"] == "new")
        numbers = [order["number"] for order in column["orders"]]
        overdue = {order["number"]: order["is_overdue"] for order in column["orders"]}

        assert numbers == [stale.number, fresh.number], "порядок не изменился"
        assert overdue[fresh.number] is True, "просроченный обязан быть помечен"
        assert overdue[stale.number] is False
