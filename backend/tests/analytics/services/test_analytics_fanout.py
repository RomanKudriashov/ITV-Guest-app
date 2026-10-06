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


# --- Отзыв о заказе из нескольких заведений — как в разделе «Отзывы» (п.36) --


def _review_on(order, ctx, rating=2):
    from apps.reviews.models import Review

    return Review.objects.create(order=order, guest_session=ctx["session"], rating=rating, low_threshold=3)


def test_a_review_of_a_two_venue_order_reaches_each_venue_and_counts_once(crystal):
    """
    Раздел «Отзывы» показывает отзыв о заказе «кухня + бар» у обеих частей;
    аналитика клала его только на рум-сервис. Теперь — у каждой части, а итог
    отеля считает его один раз.
    """
    from apps.analytics.models import ReviewDaily
    from apps.analytics.services import queries
    from apps.accounts.models import User

    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)
        review = _review_on(parent, ctx)
        collector.write_raw(crystal.pk, collector.build_review(review, crystal))
        recompute_aggregates(crystal.pk)

        points = {row.point_key: row.part for row in ReviewDaily.objects.all()}
        assert points == {str(ctx["rs_ep"].pk): False, str(ctx["kitchen_ep"].pk): True, str(ctx["bar_ep"].pk): True}

        admin = User.objects.create_user(
            email="admin36@crystal.local", password="x", hotel=crystal, is_hotel_admin=True, is_staff_member=True
        )
        whole = queries.reviews(crystal, admin, {"preset": "month"})
        assert whole["totals"]["reviews"] == 1, "по отелю отзыв один"
        by_point = {row["key"]: row["reviews"] for row in whole["by_point"]}
        assert by_point[str(ctx["kitchen_ep"].pk)] == 1 and by_point[str(ctx["bar_ep"].pk)] == 1

        kitchen = queries.reviews(crystal, admin, {"preset": "month", "point_id": str(ctx["kitchen_ep"].pk)})
        assert kitchen["totals"]["reviews"] == 1 and kitchen["totals"]["low"] == 1, "у кухни отзыв есть"


def test_recompute_from_orders_puts_old_reviews_on_their_parts(crystal):
    """Команда пересчёта истории раскладывает уже оставленные отзывы по частям."""
    from apps.analytics.models import ReviewDaily

    with tenant_context(crystal):
        ctx = _setup()
        parent = _place(ctx)
        _review_on(parent, ctx, rating=5)
        rebuild_raw_from_orders(crystal.pk)
        recompute_aggregates(crystal.pk)
        parts = set(ReviewDaily.objects.filter(part=True).values_list("point_key", flat=True))
    assert parts == {str(ctx["kitchen_ep"].pk), str(ctx["bar_ep"].pk)}
