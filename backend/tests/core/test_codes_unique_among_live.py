"""
УНИКАЛЬНОСТЬ КОДОВ — ТОЛЬКО СРЕДИ ЖИВЫХ (партия 44, п.76).

Мягко удалённая строка держала код навсегда: удалили «bar» — нового «bar» не
завести (409 «уже существует»). Теперь индексы условные (`deleted_at IS NULL`):
удалённая строка ключ не держит, два живых по-прежнему отказ.
"""

from __future__ import annotations

import pytest
from django.apps import apps as django_apps
from django.db import IntegrityError, connection, transaction

from apps.core.context import tenant_context
from apps.core.migration_guards import assert_no_live_duplicates
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db

CONDITIONAL = {
    ("hotels", "Service"): "uniq_service_per_hotel",
    ("hotels", "ExecutionPoint"): "uniq_execution_point_per_hotel",
    ("hotels", "Location"): "uniq_location_per_hotel",
    ("catalog", "Category"): "uniq_category_code_per_hotel",
    ("catalog", "Item"): "uniq_item_code_per_hotel",
    ("catalog", "ModifierGroup"): "uniq_modifier_group_per_item",
    ("catalog", "ModifierOption"): "uniq_modifier_option_per_group",
    ("catalog", "RequestField"): "uniq_request_field_per_item",
    ("catalog", "Allergen"): "uniq_allergen_per_hotel",
    ("catalog", "DietaryMarker"): "uniq_dietary_marker_per_hotel",
    ("grms", "Binding"): "uniq_grms_binding_per_element",
}


@pytest.mark.parametrize(("model", "name"), CONDITIONAL.items(), ids=lambda v: str(v))
def test_the_code_constraint_counts_only_live_rows(model, name):
    """Сторож: каждое из ограничений — условное, по `deleted_at IS NULL`."""
    meta = django_apps.get_model(*model)._meta
    constraint = next(c for c in meta.constraints if c.name == name)
    assert "deleted_at__isnull" in str(constraint.condition), f"{name} снова держит удалённые строки"


def test_binding_variable_constraint_counts_only_live_rows():
    meta = django_apps.get_model("grms", "Binding")._meta
    constraint = next(c for c in meta.constraints if c.name == "uniq_grms_variable_used_once")
    assert "deleted_at__isnull" in str(constraint.condition)


def test_a_deleted_bar_can_be_created_again_and_two_live_are_refused(cms, crystal):
    """
    УКУС. Удалили сервис «bar» — новый «bar» заводится (201). Второй живой «bar»
    — отказ 409, как раньше.
    """
    with tenant_context(crystal):
        bar = Service.objects.get(code="bar")
    removed = cms.delete(f"/api/cms/services/{bar.pk}")
    assert removed.status_code == 200, removed.content

    again = cms.post("/api/cms/services", {"code": "bar", "type": "bar", "public_name": {"ru": "Бар"}})
    assert again.status_code == 201, again.content

    twin = cms.post("/api/cms/services", {"code": "bar", "type": "bar", "public_name": {"ru": "Бар 2"}})
    assert twin.status_code == 409, twin.content


def test_the_spare_point_code_is_checked_for_being_taken(cms, crystal):
    """Запасной код точки `{code}-ep` занят — берётся следующий, а не падение."""
    with tenant_context(crystal):
        for code in ("garden", "garden-ep"):
            ExecutionPoint.objects.create(code=code, title={"ru": code}, kind=ExecutionPoint.Kind.OTHER)

    created = cms.post("/api/cms/services", {"code": "garden", "public_name": {"ru": "Сад"}})
    assert created.status_code == 201, created.content
    with tenant_context(crystal):
        service = Service.objects.select_related("execution_point").get(code="garden")
        assert service.execution_point.code == "garden-ep-2"


def test_a_deleted_item_code_is_free_at_the_database(crystal):
    """Код позиции, удалённой мягко, свободен на уровне базы; два живых — отказ."""
    from apps.catalog.models import Item

    with tenant_context(crystal):
        item = Item.objects.exclude(code="").first()
        item.delete()
        twin = Item.objects.create(code=item.code, category=item.category, title={"ru": "Снова"})
        assert twin.pk != item.pk
        with pytest.raises(IntegrityError), transaction.atomic():
            Item.objects.create(code=item.code, category=item.category, title={"ru": "Третья"})


def test_the_migration_guard_names_live_duplicates(crystal):
    """
    Сторож миграции не холостой: на ключе, где живые дубли есть заведомо (тип
    сервиса), он падает и называет их; на настоящих ключах кодов — молчит.
    """

    class Editor:
        connection = connection

    with pytest.raises(RuntimeError, match="живых"):
        assert_no_live_duplicates([("hotels", "Service", ("type",))])(django_apps, Editor())

    assert_no_live_duplicates([("hotels", "Service", ("code",)), ("catalog", "Item", ("code",))])(
        django_apps, Editor()
    )
