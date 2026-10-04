"""
Мёртвая колонка `catalog_service_location.delivery_modes` удалена (партия 30).

С волны 7 её никто не читал и не писал: способ получения следует из вида
места. Её оставили на одну волну ради дешёвого отката — и обещали убрать.
"""

from __future__ import annotations

import pytest
from django.db import connection

from apps.catalog.models import ServiceLocation

pytestmark = pytest.mark.django_db


def test_the_dead_column_is_gone_from_model_and_table():
    assert "delivery_modes" not in {field.name for field in ServiceLocation._meta.get_fields()}
    with connection.cursor() as cursor:
        columns = {c.name for c in connection.introspection.get_table_description(cursor, "catalog_service_location")}
    assert "delivery_modes" not in columns
