"""
Аналитика разъезда (R2 C4): единица — parent-агрегат (несёт деньги + агрегат
позиций с исполнителями children); children в аналитику не идут (не двоят
выручку). Пересчёт из заказов совпадает с этим правилом.
"""

from __future__ import annotations

import pytest
from django.db.models import Sum

from apps.accounts.models import GuestSession, TrustLevel
from apps.analytics.services import collector
from apps.analytics.models import ItemDaily, OrderDaily
from apps.analytics.services.recompute import rebuild_raw_from_orders, recompute_aggregates
from apps.catalog.services import inclusions as inc_svc
from apps.catalog.models import Category, Item, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Room, Service
from apps.orders.services import OrderInput, OrderLineInput, create_order

pytestmark = pytest.mark.django_db


def _setup():
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
    _raw, token_hash = GuestSession.issue_token()
    session = GuestSession.objects.create(room=room, token_hash=token_hash, trust=TrustLevel.ROOM_SCANNED, expires_at=GuestSession.default_expiry())
    return dict(steak=steak, cocktail=cocktail, room=room, session=session, kitchen_ep=kitchen_ep, bar_ep=bar_ep, rs_ep=rs_ep)


def _place(ctx):
    return create_order(
        OrderInput(
            lines=[OrderLineInput(item_id=str(ctx["steak"].pk)), OrderLineInput(item_id=str(ctx["cocktail"].pk))],
            service_code="rs",
            room_id=str(ctx["room"].pk),
        ),
        guest_session=ctx["session"],
    )


def test_build_created_parent_aggregates_children(crystal):
    with tenant_context(crystal):
        parent = _place(ctx := _setup())
        raws = collector.build_created(parent, crystal)
        header = next(r for r in raws if r["kind"] == "order_created")
        assert header["measures"]["revenue_minor"] == 165000  # деньги на parent
        assert header["measures"]["items_count"] == 2
        items = [r for r in raws if r["kind"] == "order_item"]
        assert len(items) == 2
        # Позиции атрибутированы реальным исполнителям (children), не агрегатору.
        assert {r["dimensions"]["point_key"] for r in items} == {
            str(ctx["kitchen_ep"].pk), str(ctx["bar_ep"].pk)
        }


def test_recompute_counts_parent_once(crystal):
    with tenant_context(crystal):
        ctx = _setup()
        _place(ctx)  # фанный заказ на 165000
        rebuild_raw_from_orders(crystal.pk)
        recompute_aggregates(crystal.pk)

        # Выручка = только parent (165000); children (0 денег) не в счёт.
        assert (OrderDaily.objects.aggregate(s=Sum("revenue_minor"))["s"] or 0) == 165000
        # Позиция стейка атрибутирована кухне (исполнителю), не агрегатору.
        steak_daily = ItemDaily.objects.filter(item_key=str(ctx["steak"].pk)).first()
        assert steak_daily is not None and steak_daily.point_key == str(ctx["kitchen_ep"].pk)
