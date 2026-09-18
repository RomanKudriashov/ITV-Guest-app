"""
Статистика баннера: показы, клики, переходы, CTR — и чего в ней быть не должно.

CTR СЧИТАЕТСЯ ПО СОПОСТАВИМЫМ ЕДИНИЦАМ. Показ у нас — на сессию; значит и в
числителе сессия, а не общее число нажатий. Гость, нажавший трижды, — один
заинтересовавшийся, а не триста процентов.
"""

from __future__ import annotations

import pytest

from apps.analytics.models import AnalyticsEvent, OrderDaily
from apps.core.context import tenant_context

pytestmark = pytest.mark.django_db


def _stats(cms, banner_id):
    rows = cms.get("/api/cms/banners").json()["items"]
    return next(row["stats"] for row in rows if row["id"] == str(banner_id))


def test_four_numbers_add_up(guest, banner, cms, crystal):
    row = banner()
    watcher = guest(room="201")
    clicker = guest(room="205")
    watcher("/api/guest/banner")
    clicker("/api/guest/banner")
    clicker(f"/api/guest/banner/{row.pk}/click", "post")
    clicker(f"/api/guest/banner/{row.pk}/click", "post")

    stats = _stats(cms, row.pk)
    assert stats["impressions"] == 2, "показ — на сессию"
    assert stats["clicks"] == 2, "нажатия считаются все"
    assert stats["reached"] == 1, "переход — сессия, дошедшая до действия"
    assert stats["ctr"] == 0.5


def test_a_click_without_an_impression_changes_nothing(guest, banner, cms):
    """Нажатие в обход показа — не наша механика; счёт от него не двигается."""
    row = banner()
    call = guest()
    answer = call(f"/api/guest/banner/{row.pk}/click", "post")
    assert answer.status_code == 200 and answer.json()["ok"] is False
    assert _stats(cms, row.pk) == {
        "impressions": 0, "clicks": 0, "reached": 0, "closed": 0, "ctr": 0.0
    }


def test_closings_are_counted_too(guest, banner, cms):
    row = banner()
    call = guest()
    call("/api/guest/banner")
    call(f"/api/guest/banner/{row.pk}/close", "post")
    assert _stats(cms, row.pk)["closed"] == 1


def test_the_banner_never_lands_in_order_analytics(guest, banner, crystal):
    """
    Прямое требование заказчика. Проверяется устройством: реклама живёт в своих
    таблицах, и журнал аналитики её не видит — даже случайно.
    """
    row = banner()
    with tenant_context(crystal):
        before_events = AnalyticsEvent.objects.count()
        before_orders = list(OrderDaily.objects.values_list("orders_count", flat=True))

    call = guest()
    call("/api/guest/banner")
    call(f"/api/guest/banner/{row.pk}/click", "post")
    call(f"/api/guest/banner/{row.pk}/close", "post")

    with tenant_context(crystal):
        assert AnalyticsEvent.objects.count() == before_events, "реклама попала в журнал продаж"
        assert list(OrderDaily.objects.values_list("orders_count", flat=True)) == before_orders
