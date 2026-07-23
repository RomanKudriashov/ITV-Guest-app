"""
Коммерция: расчёт начислений, снимок сумм в заказе, минимальная сумма,
бесплатная доставка по порогу, чаевые, налог, изоляция тенантов.

Ключевая проверка — снимок: отель поменял сбор, уже оформленные заказы не
меняются.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, Item
from apps.core.context import tenant_context
from apps.hotels.models import Location
from apps.orders.charges import compute_charges
from apps.orders.services import OrderInput, OrderLineInput, create_order, get_order, quote_cart

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _caesar():
    return Item.objects.get(code="caesar")  # 550 ₽ = 55000


def _order(session=None, *, tip_minor=None, tip_percent=None, location_id=None):
    item = _caesar()
    return create_order(
        OrderInput(
            lines=[OrderLineInput(item_id=str(item.pk))],
            tip_minor=tip_minor,
            tip_percent=tip_percent,
            location_id=location_id,
        ),
        guest_session=session,
    )


def _enable_fee(hotel, bp):
    hotel.service_fee_bp = bp
    hotel.save(update_fields=["service_fee_bp"])


# --- Расчёт ----------------------------------------------------------------


def test_service_fee_and_total(crystal):
    with tenant_context(crystal):
        _enable_fee(crystal, 1000)  # 10%
        order = _order()
        assert order.subtotal_minor == 55000
        assert order.service_fee_minor == 5500  # 10% от 55000
        assert order.total == 60500


def test_pure_function_matches(crystal):
    with tenant_context(crystal):
        crystal.service_fee_bp = 1000
        crystal.tax_bp = 0
        b = compute_charges(crystal, priced_lines=[(55000, True), (10000, False)])
        # Сбор только по облагаемой позиции.
        assert b.subtotal_minor == 65000
        assert b.service_fee_minor == 5500
        assert b.total_minor == 70500


def test_default_off_keeps_total_equal_subtotal(crystal):
    with tenant_context(crystal):
        order = _order()
        assert order.service_fee_minor == 0
        assert order.total == order.subtotal_minor == 55000


# --- Снимок ----------------------------------------------------------------


def test_snapshot_is_immutable_when_hotel_changes_fee(crystal):
    with tenant_context(crystal):
        _enable_fee(crystal, 1000)
        order = _order()
        assert order.service_fee_minor == 5500

        # Отель поднял сбор до 12% — старый заказ не меняется.
        _enable_fee(crystal, 1200)
        reloaded = get_order(order.pk)
        assert reloaded.service_fee_minor == 5500
        assert reloaded.total == 60500
        assert reloaded.charges["service_fee_bp"] == 1000


# --- Минимальная сумма -----------------------------------------------------


def test_below_minimum_blocks_with_shortfall(crystal):
    from apps.core.errors import DomainError

    with tenant_context(crystal):
        cat = _caesar().category
        cat.min_order_minor = 100000  # 1000 ₽
        cat.save(update_fields=["min_order_minor"])

        with pytest.raises(DomainError) as exc:
            _order()
        assert exc.value.code == "order_below_minimum"
        assert exc.value.extra["shortfall_minor"] == 45000  # 100000 - 55000


# --- Доставка --------------------------------------------------------------


def test_free_delivery_by_threshold(crystal):
    with tenant_context(crystal):
        loc = Location.objects.filter(kind="common_point").first() or Location.objects.first()
        loc.delivery_fee_minor = 30000
        loc.save(update_fields=["delivery_fee_minor"])

        crystal.free_delivery_threshold_minor = 50000  # 500 ₽
        crystal.save(update_fields=["free_delivery_threshold_minor"])

        # 55000 ≥ 50000 → доставка бесплатна.
        b = compute_charges(crystal, priced_lines=[(55000, True)], location=loc)
        assert b.delivery_fee_minor == 0
        # 40000 < 50000 → доставка платная.
        b2 = compute_charges(crystal, priced_lines=[(40000, True)], location=loc)
        assert b2.delivery_fee_minor == 30000


# --- Чаевые и налог --------------------------------------------------------


def test_tip_percent(crystal):
    with tenant_context(crystal):
        order = _order(tip_percent=10)
        assert order.tip_minor == 5500  # 10% от 55000
        assert order.total == 60500


def test_tax_added_vs_inclusive(crystal):
    with tenant_context(crystal):
        crystal.tax_bp = 2000  # 20%
        crystal.tax_inclusive = False
        added = compute_charges(crystal, priced_lines=[(55000, True)])
        assert added.tax_minor == 11000  # 20% сверху
        assert added.total_minor == 66000

        crystal.tax_inclusive = True
        incl = compute_charges(crystal, priced_lines=[(55000, True)])
        assert incl.total_minor == 55000  # налог уже в цене
        assert incl.tax_minor > 0  # показываем «в т.ч.»


# --- Предпросчёт -----------------------------------------------------------


def test_quote_endpoint_reports_below_minimum(client, crystal, guest_token):
    with tenant_context(crystal):
        cat = _caesar().category
        cat.min_order_minor = 100000
        cat.save(update_fields=["min_order_minor"])
        item_id = str(_caesar().pk)

    resp = client.post(
        "/api/v1/guest/cart/quote",
        data={"lines": [{"item_id": item_id, "quantity": 1}]},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["subtotal_minor"] == 55000
    assert body["below_minimum"] is True
    assert body["shortfall_minor"] == 45000


# --- Сериализация ----------------------------------------------------------


def test_order_serialization_carries_charges_and_serve_by(crystal):
    from apps.orders.services import serialize_order

    with tenant_context(crystal):
        _enable_fee(crystal, 1000)
        item = _caesar()
        item.prep_minutes = 20
        item.save(update_fields=["prep_minutes"])
        order = _order()
        payload = serialize_order(get_order(order.pk))
        assert payload["charges"]["service_fee_minor"] == 5500
        assert payload["charges"]["total_minor"] == 60500
        assert payload["serve_by"]  # ожидаемое время подачи есть


# --- Изоляция --------------------------------------------------------------


def test_commerce_settings_isolated_between_hotels(crystal, aurora):
    with tenant_context(crystal):
        _enable_fee(crystal, 1000)
    with tenant_context(aurora):
        assert aurora.service_fee_bp == 0
        order = _order()
        assert order.service_fee_minor == 0
