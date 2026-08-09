"""
Разъезд заказа (R2 C3): заказ-агрегатор с позициями от разных исполнителей
разъезжается на parent (гость) + children (исполнение). Деньги на parent,
наценка overlay в снимке, статус-свод, отмена-каскад, видимость гостю/трекеру,
quote с overlay, и не-заёмный заказ — как раньше.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import GuestSession, TrustLevel
from apps.catalog.services import inclusions as inc_svc
from apps.catalog.models import Category, Item, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Room, Service
from apps.orders.services import (
    OrderInput,
    OrderLineInput,
    cancel_order_by_guest,
    change_status,
    create_order,
    get_order,
    list_guest_orders,
    quote_cart,
)
from apps.orders.services.tracker import build_board

pytestmark = pytest.mark.django_db


def _setup():
    """Рум-сервис включает кухню (+15%) и бар; свой EP. Возвращает контекст."""
    kitchen_ep = ExecutionPoint.objects.create(code="k", title={"ru": "K"}, kind=ExecutionPoint.Kind.KITCHEN)
    kitchen = Service.objects.create(execution_point=kitchen_ep, code="k", type=Service.Type.RESTAURANT, is_guest_facing=True)
    k_cat = Category.objects.create(code="k-hot", type="product", title={"ru": "Горячее"}, service=kitchen)
    Route.objects.create(category=k_cat, execution_point=kitchen_ep)
    steak = Item.objects.create(code="steak", category=k_cat, type="product", title={"ru": "Стейк"}, price=100000)

    bar_ep = ExecutionPoint.objects.create(code="b", title={"ru": "B"}, kind=ExecutionPoint.Kind.BAR)
    bar = Service.objects.create(execution_point=bar_ep, code="b", type=Service.Type.BAR, is_guest_facing=True)
    b_cat = Category.objects.create(code="b-drinks", type="product", title={"ru": "Напитки"}, service=bar)
    Route.objects.create(category=b_cat, execution_point=bar_ep)
    cocktail = Item.objects.create(code="cocktail", category=b_cat, type="product", title={"ru": "Коктейль"}, price=50000)

    rs_ep = ExecutionPoint.objects.create(code="rs", title={"ru": "RS"}, kind=ExecutionPoint.Kind.KITCHEN)
    rs = Service.objects.create(execution_point=rs_ep, code="rs", type=Service.Type.ROOM_SERVICE, is_guest_facing=True)
    inc_svc.create_inclusion(rs.pk, {"source_service_id": str(kitchen.pk), "markup_kind": "percent", "markup_value": 1500})
    inc_svc.create_inclusion(rs.pk, {"source_service_id": str(bar.pk)})

    room = Room.objects.create(number="999")
    raw, token_hash = GuestSession.issue_token()
    session = GuestSession.objects.create(
        room=room, token_hash=token_hash, trust=TrustLevel.ROOM_SCANNED, expires_at=GuestSession.default_expiry()
    )
    return dict(
        rs=rs, kitchen_ep=kitchen_ep, bar_ep=bar_ep, rs_ep=rs_ep,
        steak=steak, cocktail=cocktail, room=room, session=session,
    )


def _place(ctx):
    data = OrderInput(
        lines=[OrderLineInput(item_id=str(ctx["steak"].pk)), OrderLineInput(item_id=str(ctx["cocktail"].pk))],
        service_code="rs",
        room_id=str(ctx["room"].pk),
    )
    return create_order(data, guest_session=ctx["session"])


def test_fanout_structure_money_and_markup(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)

        assert parent.parent_id is None
        children = list(parent.children.all())
        assert len(children) == 2
        assert {str(c.execution_point_id) for c in children} == {
            str(ctx["kitchen_ep"].pk), str(ctx["bar_ep"].pk)
        }

        # Деньги — на parent, над всеми строками (стейк +15% + коктейль); crystal
        # без сборов → total == subtotal.
        assert parent.subtotal_minor == 115000 + 50000
        assert parent.total == 165000
        for child in children:
            assert child.subtotal_minor == 0  # children денег не несут

        # Наценка overlay в снимке дочерней позиции кухни.
        kitchen_child = next(c for c in children if str(c.execution_point_id) == str(ctx["kitchen_ep"].pk))
        assert kitchen_child.items.first().unit_price_snapshot == 115000


def test_fanout_status_aggregation_and_cancel(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)
        children = {str(c.execution_point_id): c for c in parent.children.all()}
        kitchen_child = children[str(ctx["kitchen_ep"].pk)]
        bar_child = children[str(ctx["bar_ep"].pk)]

        assert parent.status.is_initial  # оба child в начальном
        change_status(kitchen_child, to_code="accepted")
        parent.refresh_from_db()
        assert parent.status.code == "new"  # свод = наименее продвинутый (бар ещё new)

        change_status(kitchen_child, to_code="done")
        change_status(bar_child, to_code="done")
        parent.refresh_from_db()
        assert parent.status.is_terminal  # все терминальны → parent готов

        # Новый заказ и отмена гостем — каскадит на обе child.
        parent2 = _place(ctx)
        cancel_order_by_guest(get_order(parent2.pk), guest_session=ctx["session"])
        parent2.refresh_from_db()
        assert parent2.status.is_cancelled
        for child in parent2.children.all():
            assert child.status.is_cancelled


def test_fanout_guest_and_tracker_visibility(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)
        children = list(parent.children.all())

        # Гость видит один заказ (parent), не children.
        listing = list_guest_orders(ctx["session"])
        ids = {o["id"] for o in listing["active"] + listing["past"]}
        assert str(parent.pk) in ids
        assert not any(str(c.pk) in ids for c in children)
        # Агрегированный вид гостя показывает позиции обоих исполнителей.
        parent_view = next(o for o in listing["active"] if o["id"] == str(parent.pk))
        assert len(parent_view["items"]) == 2

        # Трекер: child кухни на доске кухни; parent НЕ на доске агрегатора.
        kitchen_numbers = [
            o["number"] for col in build_board(ctx["kitchen_ep"])["columns"] for o in col["orders"]
        ]
        kitchen_child = next(c for c in children if str(c.execution_point_id) == str(ctx["kitchen_ep"].pk))
        assert kitchen_child.number in kitchen_numbers

        rs_numbers = [
            o["number"] for col in build_board(ctx["rs_ep"])["columns"] for o in col["orders"]
        ]
        assert parent.number not in rs_numbers


def test_borrowed_cocktail_lands_on_the_bar_board_with_its_source(crystal):
    """
    Стык R2 → R3: заимствованная позиция обязана доехать до доски СВОЕГО
    исполнителя и назваться там своим происхождением.

    Коктейль гость взял в рум-сервисе, а готовит его бар — на доске бара
    появляется суб-заказ. Без пометки источника бармен видит заявку ниоткуда:
    гость назовёт номер своего заказа, а такого номера на доске нет.
    """
    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)

        bar_board = build_board(ctx["bar_ep"])
        cards = [order for column in bar_board["columns"] for order in column["orders"]]
        assert len(cards) == 1, "коктейль не долетел до доски бара"
        cocktail_card = cards[0]

        titles = [line["title"] for line in cocktail_card["items"]]
        assert titles == ["Коктейль"], "на доске бара оказался чужой стейк"

        # Пометка источника: номер ГОСТЕВОГО заказа и сервис, через который он сделан.
        assert cocktail_card["source_order"]["number"] == parent.number
        assert cocktail_card["source_order"]["service_code"] == "rs"

        # А на доске кухни — стейк, и со своей пометкой того же источника.
        kitchen_cards = [
            order for column in build_board(ctx["kitchen_ep"])["columns"] for order in column["orders"]
        ]
        assert [line["title"] for line in kitchen_cards[0]["items"]] == ["Стейк"]
        assert kitchen_cards[0]["source_order"]["number"] == parent.number


def test_plain_order_has_no_source_marking(crystal):
    """Обычный заказ (один исполнитель) ничего не заимствует — пометки нет."""
    with tenant_context(crystal):
        ctx = _setup()
        data = OrderInput(
            lines=[OrderLineInput(item_id=str(ctx["cocktail"].pk))],
            service_code="b",
            room_id=str(ctx["room"].pk),
        )
        create_order(data, guest_session=ctx["session"])

        cards = [o for column in build_board(ctx["bar_ep"])["columns"] for o in column["orders"]]
        assert cards[0]["source_order"] is None


def test_quote_overlay_reconciles_with_order(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        quote = quote_cart(
            OrderInput(
                lines=[OrderLineInput(item_id=str(ctx["steak"].pk)), OrderLineInput(item_id=str(ctx["cocktail"].pk))],
                service_code="rs",
                room_id=str(ctx["room"].pk),
            )
        )
        assert quote["subtotal_minor"] == 165000  # 115000 + 50000, с наценкой
        parent = _place(ctx)
        assert parent.subtotal_minor == quote["subtotal_minor"]  # снимок сходится с quote


def test_nonborrowed_order_stays_flat(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        # Заказ прямо у кухни-источника, без service_code → плоский, без parent.
        data = OrderInput(lines=[OrderLineInput(item_id=str(ctx["steak"].pk))], room_id=str(ctx["room"].pk))
        order = create_order(data, guest_session=ctx["session"])
        assert order.parent_id is None
        assert not order.children.exists()
        assert order.subtotal_minor == 100000  # без наценки (не заимствование)
