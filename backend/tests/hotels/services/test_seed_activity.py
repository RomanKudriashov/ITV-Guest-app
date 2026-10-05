"""
Генератор активности демо-стенда (`seed_activity`) работает на нынешних правилах заказа.

С партии 31 (DEV-01) отмена без причины отвергается, а генератор отменял без
неё и падал на первой же отмене: история демо-отелей не наполнялась, и
`check_demo_stand` локально краснел «заказов 0, ожидалось не меньше 50».
Тестов на генератор не было — поломку заметили только по стенду.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.core.context import tenant_context
from apps.orders.models import Order

pytestmark = pytest.mark.django_db


def test_generator_fills_history_and_every_cancellation_has_a_reason(crystal):
    call_command("seed_activity", subdomain=["crystal"], orders=60, verbosity=0)

    with tenant_context(crystal):
        orders = Order.objects.filter(guest_session__guest_ref="actgen:v1")
        # Часть заказов генератор пропускает сам и пишет почему (бронь без
        # времени и т. п.) — это его правило, а не сбой; история должна быть.
        assert orders.count() >= 30, orders.count()
        cancelled = orders.filter(status__is_cancelled=True)
        assert cancelled.exists(), "при доле отмен 11 % на 60 заказах отмены обязаны быть"
        reasons = set(cancelled.values_list("cancel_reason", flat=True))
        assert reasons <= set(Order.CancelReason.values), reasons
        assert "" not in reasons
