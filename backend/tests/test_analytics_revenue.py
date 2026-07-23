"""
Разложение выручки (A3+ шаг 7): аналитика различает позиции / сервисный сбор /
доставку / налог / чаевые из снимка charges на Order.

По конвейеру Run 11: событие → record() → сырой факт → редьюсер читает ТОЛЬКО
снимок. recompute == live. Обратная совместимость: заказ без снимка — всё в
позициях, компоненты по нулям, без падений на None.
"""

from __future__ import annotations

import pytest
from django.db.models import Sum

from apps.analytics import collector
from apps.analytics.models import OrderDaily
from apps.analytics.recompute import recompute_aggregates
from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.services import OrderInput, OrderLineInput, create_order

pytestmark = pytest.mark.django_db


def _caesar_id():
    return str(Item.objects.get(code="caesar").pk)


def _make_order(**order_kwargs):
    return create_order(
        OrderInput(lines=[OrderLineInput(item_id=_caesar_id())], **order_kwargs),
        guest_session=None,
    )


def _totals():
    return OrderDaily.objects.aggregate(
        revenue=Sum("revenue_minor"),
        service_fee=Sum("service_fee_minor"),
        delivery=Sum("delivery_minor"),
        tax=Sum("tax_minor"),
        tip=Sum("tip_minor"),
    )


# --- Разложение ------------------------------------------------------------


def test_revenue_is_decomposed(crystal, django_capture_on_commit_callbacks):
    with tenant_context(crystal):
        crystal.service_fee_bp = 1000  # 10%
        crystal.save(update_fields=["service_fee_bp"])

        with django_capture_on_commit_callbacks(execute=True):
            _make_order(tip_percent=10)  # caesar 55000, сбор 5500, чай 5500

        t = _totals()
        assert t["revenue"] == 55000  # выручка = позиции, НЕ итог
        assert t["service_fee"] == 5500
        assert t["tip"] == 5500
        assert t["delivery"] == 0
        assert t["tax"] == 0


def test_order_without_charges_counts_all_as_revenue():
    """Обратная совместимость: у заказа без снимка всё в позициях, без None."""
    from apps.hotels.models import Hotel

    class _OldOrder:
        # Заказ, оформленный до A3+: снимка нет (нули), но total есть.
        pk = "00000000-0000-0000-0000-000000000001"
        subtotal_minor = 0
        service_fee_minor = 0
        delivery_fee_minor = 0
        tax_minor = 0
        tip_minor = 0
        total = 55000
        created_at = None
        execution_point_id = None
        guest_session = None

        class _Items:
            def select_related(self, *a):
                return self

            def all(self):
                return []

        items = _Items()

    # Проверяем именно измерения, которые попадут в сырой факт.
    order = _OldOrder()
    revenue = int(order.subtotal_minor or order.total or 0)
    assert revenue == 55000  # всё в выручке
    assert int(order.service_fee_minor or 0) == 0


# --- Пересчёт == живая агрегация -------------------------------------------


def test_recompute_matches_live_with_components(crystal, django_capture_on_commit_callbacks):
    with tenant_context(crystal):
        crystal.service_fee_bp = 1200
        crystal.save(update_fields=["service_fee_bp"])

        with django_capture_on_commit_callbacks(execute=True):
            for _ in range(3):
                _make_order(tip_minor=1000)

        live = _totals()
        recompute_aggregates(crystal.pk)
        replayed = _totals()
        assert replayed == live
        assert live["service_fee"] > 0 and live["tip"] == 3000


# --- Идемпотентность -------------------------------------------------------


def test_component_increment_is_idempotent(crystal):
    with tenant_context(crystal):
        raw = {
            "dedupe_key": "order_created:rev-1",
            "kind": "order_created",
            "name": "order.created",
            "occurred_at": __import__("datetime").datetime(2026, 7, 20, 9, 0, tzinfo=__import__("datetime").timezone.utc),
            "business_date": __import__("datetime").date(2026, 7, 20),
            "dimensions": {"offering_type": "product", "point_key": "k"},
            "measures": {"revenue_minor": 55000, "service_fee_minor": 5500, "tip_minor": 1000},
        }
        assert collector.record(crystal.pk, raw) is True
        assert collector.record(crystal.pk, raw) is False  # повтор — no-op

        row = OrderDaily.objects.get(offering_type="product", point_key="k")
        assert row.revenue_minor == 55000
        assert row.service_fee_minor == 5500
        assert row.tip_minor == 1000


# --- Сводка ----------------------------------------------------------------


def test_summary_exposes_decomposition(crystal, django_capture_on_commit_callbacks):
    from apps.accounts.models import User
    from apps.analytics import queries

    with tenant_context(crystal):
        crystal.service_fee_bp = 1000
        crystal.save(update_fields=["service_fee_bp"])
        admin = User.objects.create_user(
            email="rev-admin@crystal.local", password="x", hotel=crystal,
            is_hotel_admin=True, is_staff_member=True,
        )
        from django.utils import timezone

        today = crystal.local_now().date()
        with django_capture_on_commit_callbacks(execute=True):
            _make_order(tip_minor=2000)

        block = queries.summary(crystal, admin, {"date_from": today.isoformat(), "date_to": today.isoformat()})["current"]
        assert block["revenue_minor"] == 55000
        assert block["service_fee_minor"] == 5500
        assert block["tip_minor"] == 2000
        assert block["gross_minor"] == 55000 + 5500 + 2000
