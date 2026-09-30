"""
Сид и запрет «одно активное правило эскалации на точку» (бэклог, пункт 39).

Сид искал правило по имени, собранному из названия заведения: после
переименования «SPA-центр» → «СПА «Кристалл»» он заводил второе активное
правило на ту же точку мимо серверного запрета. Дубль есть и на стенде.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.management.commands.seed_demo_hotel import Command
from apps.hotels.models import ExecutionPoint
from apps.notifications.models import EscalationRule
from apps.notifications.models.vocabulary import TargetKind

pytestmark = pytest.mark.django_db

STEPS = [(0, TargetKind.POINT, "Сразу"), (30, TargetKind.MANAGER, "Через 30")]


def _active(point) -> int:
    return EscalationRule.objects.filter(execution_point=point, is_active=True).count()


def test_renamed_venue_does_not_get_a_second_rule(crystal):
    """Правило у точки есть под старым именем — сид второго не заводит."""
    with tenant_context(crystal):
        spa = ExecutionPoint.objects.get(code="spa")
        EscalationRule.objects.filter(execution_point=spa).delete()
        EscalationRule.objects.create(name="SPA-центр: подъём по норме", execution_point=spa)

        created = Command()._ensure_point_rule(spa, "СПА «Кристалл»: подъём по норме", STEPS)

        assert created is None
        assert _active(spa) == 1


def test_point_without_a_rule_gets_exactly_one(crystal):
    with tenant_context(crystal):
        spa = ExecutionPoint.objects.get(code="spa")
        EscalationRule.objects.filter(execution_point=spa).delete()

        first = Command()._ensure_point_rule(spa, "СПА: подъём", STEPS)
        again = Command()._ensure_point_rule(spa, "Совсем другое имя", STEPS)

        assert first is not None and first.steps.count() == 2
        assert again is None
        assert _active(spa) == 1


def test_inactive_rule_does_not_block_a_new_one(crystal):
    """Выключенное правило — не активное: запрет API его не считает, сид тоже."""
    with tenant_context(crystal):
        spa = ExecutionPoint.objects.get(code="spa")
        EscalationRule.objects.filter(execution_point=spa).delete()
        EscalationRule.objects.create(name="старое", execution_point=spa, is_active=False)

        assert Command()._ensure_point_rule(spa, "новое", STEPS) is not None
        assert _active(spa) == 1


def test_fresh_seed_leaves_no_point_with_two_active_rules(crystal):
    """Сид, прогнанный по тестовому отелю, дублей не оставляет."""
    from collections import Counter

    with tenant_context(crystal):
        counts = Counter(
            EscalationRule.objects.filter(is_active=True).values_list("execution_point_id", flat=True)
        )
    assert [point for point, n in counts.items() if n > 1] == []


def test_the_database_refuses_a_second_active_rule_on_a_point(crystal):
    """
    Запрет в базе (миграция notifications 0004): мимо API второе активное
    правило на точку не встаёт. Выключенное и общее правило отеля — свои случаи.
    """
    from django.db import IntegrityError, transaction

    with tenant_context(crystal):
        spa = ExecutionPoint.objects.get(code="spa")
        EscalationRule.objects.filter(execution_point=spa).delete()
        EscalationRule.objects.create(name="первое", execution_point=spa)

        with pytest.raises(IntegrityError), transaction.atomic():
            EscalationRule.objects.create(name="второе", execution_point=spa)

        # Выключенное — не в счёт.
        EscalationRule.objects.create(name="выключенное", execution_point=spa, is_active=False)

        # Общее правило отеля — одно активное; NULL в индексе ограничен отдельно.
        EscalationRule.objects.filter(execution_point__isnull=True).delete()
        EscalationRule.objects.create(name="общее", execution_point=None)
        with pytest.raises(IntegrityError), transaction.atomic():
            EscalationRule.objects.create(name="второе общее", execution_point=None)
