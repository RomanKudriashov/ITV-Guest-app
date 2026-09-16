"""
Удаление локации или категории убирает её связки в матрице.

Удаление мягкое, и связки оставались жить: на стенде «Напитки × Спа-NNNNNN»
накопилось 129 — по одной на прогон, заводивший и удалявший локацию. Любой
подсчёт матрицы видел их как живые («90 из 112 — только самовывоз»).
"""

from __future__ import annotations

import pytest

from apps.catalog.models import ServiceLocation
from apps.core.context import tenant_context
from apps.hotels.models import Location

pytestmark = pytest.mark.django_db


def _link_count(hotel, **filters) -> int:
    with tenant_context(hotel):
        return ServiceLocation.all_objects.filter(**filters).count()


def test_deleting_a_location_drops_its_matrix_links(cms, crystal):
    created = cms.post(
        "/api/cms/locations", {"kind": "common_point", "title": {"ru": "Спа-утечка"}}
    )
    assert created.status_code in (200, 201), created.content
    location_id = created.json()["id"]
    with tenant_context(crystal):
        category_id = str(
            ServiceLocation.objects.values_list("category_id", flat=True).first()
        )
    saved = cms.put(
        "/api/cms/locations/matrix",
        {"category_id": category_id, "cells": [{"location_id": location_id, "enabled": True}]},
    )
    assert saved.status_code == 200, saved.content
    assert _link_count(crystal, location_id=location_id) == 1

    assert cms.delete(f"/api/cms/locations/{location_id}").status_code in (200, 204)
    assert _link_count(crystal, location_id=location_id) == 0
    with tenant_context(crystal):
        assert Location.all_objects.get(pk=location_id).deleted_at is not None, "сама — мягко"


def test_deleting_a_category_drops_its_matrix_links(cms, crystal, service_id):
    created = cms.post(
        "/api/cms/categories",
        {"title": {"ru": "Категория-утечка"}, "type": "product", "service_id": service_id},
    )
    assert created.status_code in (200, 201), created.content
    category_id = created.json()["id"]
    with tenant_context(crystal):
        location_id = str(Location.objects.first().pk)
    cms.put(
        "/api/cms/locations/matrix",
        {"category_id": category_id, "cells": [{"location_id": location_id, "enabled": True}]},
    )
    assert _link_count(crystal, category_id=category_id) == 1

    assert cms.delete(f"/api/cms/categories/{category_id}").status_code in (200, 204)
    assert _link_count(crystal, category_id=category_id) == 0
