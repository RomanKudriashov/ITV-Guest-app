"""
Сторож списка защищённых таблиц.

Новую тенант-таблицу легко добавить и забыть включить ей RLS — тогда дыра
появится тихо. Этот тест находит все модели с полем hotel и требует, чтобы
каждая была либо в списке миграции 0002_rls, либо в явном списке исключений.
"""

from __future__ import annotations

import pytest
from django.apps import apps
from django.db import connection

from apps.core.tenant_tables import (
    NULLABLE_TENANT_TABLES,
    PLATFORM_TABLES,
    TENANT_TABLES,
)

pytestmark = pytest.mark.django_db


def _models_with_hotel():
    for model in apps.get_models():
        field_names = {field.name for field in model._meta.get_fields()}
        if "hotel" in field_names:
            yield model


def test_every_tenant_table_is_listed():
    listed = set(TENANT_TABLES) | set(NULLABLE_TENANT_TABLES)
    missing = {
        model._meta.db_table
        for model in _models_with_hotel()
        if model._meta.db_table not in listed
        and model._meta.db_table not in PLATFORM_TABLES
    }
    assert not missing, (
        "Эти таблицы имеют hotel_id, но не защищены RLS — добавь их в "
        f"apps/core/tenant_tables.py: {sorted(missing)}"
    )


def test_listed_tables_actually_have_policies():
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname
            FROM pg_policy p
            JOIN pg_class c ON c.oid = p.polrelid
            WHERE p.polname = 'tenant_isolation'
            """
        )
        protected = {row[0] for row in cursor.fetchall()}

    expected = set(TENANT_TABLES) | set(NULLABLE_TENANT_TABLES)
    assert expected <= protected, f"Без политики остались: {sorted(expected - protected)}"


def test_platform_tables_are_not_protected():
    """Отель обязан быть находимым до установки контекста — иначе не войти."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT relrowsecurity FROM pg_class WHERE relname = 'hotels_hotel'")
        (enabled,) = cursor.fetchone()
    assert enabled is False
