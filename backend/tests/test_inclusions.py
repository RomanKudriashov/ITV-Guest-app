"""
Включения сервисов (R2 C1): создание/подмножество, overlay-наценка, запрет
циклов и самовключения, уникальность пары, RLS-изоляция, CMS API.
Резолв эффективного каталога и единый источник правды — в test_inclusions_resolve (C2).
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.catalog import inclusions as svc
from apps.catalog.models import Category, ServiceInclusion
from apps.core.context import tenant_context
from apps.core.errors import ConflictError
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db


def _service(code: str, service_type: str = Service.Type.RESTAURANT) -> Service:
    ep = ExecutionPoint.objects.create(
        code=code, title={"ru": code}, kind=ExecutionPoint.Kind.KITCHEN
    )
    return Service.objects.create(
        execution_point=ep, code=code, type=service_type, is_guest_facing=True
    )


def test_markup_apply():
    percent = ServiceInclusion(markup_kind="percent", markup_value=1500)
    assert percent.apply_markup(10000) == 11500  # +15%
    amount = ServiceInclusion(markup_kind="amount", markup_value=5000)
    assert amount.apply_markup(10000) == 15000
    none = ServiceInclusion(markup_kind="none", markup_value=0)
    assert none.apply_markup(10000) == 10000
    assert none.apply_markup(None) is None  # цены нет — наценка ни при чём


def test_create_subset_with_categories(crystal):
    with tenant_context(crystal):
        agg, source = _service("agg"), _service("src")
        category = Category.objects.create(
            code="src-cat", type="product", title={"ru": "C"}, service=source
        )
        inclusion = svc.create_inclusion(
            agg.pk,
            {
                "source_service_id": str(source.pk),
                "scope": "categories",
                "markup_kind": "percent",
                "markup_value": 1500,
                "category_ids": [str(category.pk)],
            },
        )
        data = svc.serialize_inclusion(inclusion)
        assert data["source_service_id"] == str(source.pk)
        assert data["scope"] == "categories"
        assert data["category_ids"] == [str(category.pk)]
        assert data["markup_value"] == 1500


def test_self_inclusion_blocked(crystal):
    with tenant_context(crystal):
        a = _service("selfy")
        with pytest.raises(ConflictError):
            svc.create_inclusion(a.pk, {"source_service_id": str(a.pk)})


def test_direct_cycle_blocked(crystal):
    with tenant_context(crystal):
        a, b = _service("a"), _service("b")
        svc.create_inclusion(a.pk, {"source_service_id": str(b.pk)})  # a ⊃ b
        with pytest.raises(ConflictError):
            svc.create_inclusion(b.pk, {"source_service_id": str(a.pk)})  # b ⊃ a → цикл


def test_transitive_cycle_blocked(crystal):
    with tenant_context(crystal):
        a, b, c = _service("ta"), _service("tb"), _service("tc")
        svc.create_inclusion(a.pk, {"source_service_id": str(b.pk)})  # a ⊃ b
        svc.create_inclusion(b.pk, {"source_service_id": str(c.pk)})  # b ⊃ c
        with pytest.raises(ConflictError):
            svc.create_inclusion(c.pk, {"source_service_id": str(a.pk)})  # c ⊃ a → цикл


def test_unique_pair(crystal):
    with tenant_context(crystal):
        a, b = _service("ua"), _service("ub")
        svc.create_inclusion(a.pk, {"source_service_id": str(b.pk)})
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                svc.create_inclusion(a.pk, {"source_service_id": str(b.pk)})


def test_rls_isolation(crystal, aurora):
    with tenant_context(crystal):
        a, b = _service("ria"), _service("rib")
        svc.create_inclusion(a.pk, {"source_service_id": str(b.pk)})
    with tenant_context(aurora):
        assert not ServiceInclusion.objects.filter(including_service__code="ria").exists()


def test_cms_api_crud(cms, crystal):
    with tenant_context(crystal):
        agg_id = str(Service.objects.get(code="kitchen").pk)
        src_id = str(Service.objects.get(code="bar").pk)

    created = cms.post(
        f"/api/v1/cms/services/{agg_id}/inclusions",
        {"source_service_id": src_id, "markup_kind": "percent", "markup_value": 1000},
    )
    assert created.status_code == 201, created.content
    inclusion_id = created.json()["id"]

    listed = cms.get(f"/api/v1/cms/services/{agg_id}/inclusions").json()
    assert any(entry["id"] == inclusion_id for entry in listed)

    patched = cms.patch(f"/api/v1/cms/inclusions/{inclusion_id}", {"markup_value": 2000})
    assert patched.json()["markup_value"] == 2000

    assert cms.delete(f"/api/v1/cms/inclusions/{inclusion_id}").status_code == 200
    after = cms.get(f"/api/v1/cms/services/{agg_id}/inclusions").json()
    assert not any(entry["id"] == inclusion_id for entry in after)


def test_cms_api_rejects_cycle(cms, crystal):
    with tenant_context(crystal):
        kitchen_id = str(Service.objects.get(code="kitchen").pk)
        bar_id = str(Service.objects.get(code="bar").pk)
    assert cms.post(
        f"/api/v1/cms/services/{kitchen_id}/inclusions", {"source_service_id": bar_id}
    ).status_code == 201
    cycle = cms.post(f"/api/v1/cms/services/{bar_id}/inclusions", {"source_service_id": kitchen_id})
    assert cycle.status_code == 409
    assert cycle.json()["code"] == "inclusion_cycle"
