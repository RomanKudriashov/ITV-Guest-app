"""
Резолв эффективного каталога (R2 C2): объединённое меню агрегатора, overlay
(наценка/скрытие/доступность-пересечение), резолв исполнителя и ЕДИНЫЙ ИСТОЧНИК
ПРАВДЫ — правка позиции источника отражается у заёмщика без копии.
"""

from __future__ import annotations

import pytest

from apps.catalog import inclusions as inc_svc
from apps.catalog.models import Category, Item, Route
from apps.catalog.services import MenuOptions, build_menu
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Schedule, Service

pytestmark = pytest.mark.django_db


def _service(code: str, service_type: str = Service.Type.RESTAURANT) -> Service:
    ep = ExecutionPoint.objects.create(code=code, title={"ru": code}, kind=ExecutionPoint.Kind.KITCHEN)
    return Service.objects.create(execution_point=ep, code=code, type=service_type, is_guest_facing=True)


def _source_with_item(price: int = 100000):
    source = _service("src-k")
    category = Category.objects.create(
        code="src-hot", type="product", title={"ru": "Горячее"}, service=source
    )
    Route.objects.create(category=category, execution_point=source.execution_point)
    item = Item.objects.create(
        code="src-steak", category=category, type="product", title={"ru": "Стейк"}, price=price
    )
    return source, category, item


def _menu(code: str, crystal):
    return build_menu(MenuOptions(offering_type="product", point_code=code), hotel=crystal)


def _borrowed_item(menu, cat_code="src-hot", item_code="src-steak"):
    cats = {c["code"]: c for c in menu["categories"]}
    assert cat_code in cats, f"{cat_code} нет в меню: {list(cats)}"
    return next(i for i in cats[cat_code]["items"] if i["code"] == item_code)


def test_merges_borrowed_with_markup(crystal):
    with tenant_context(crystal):
        source, _, _ = _source_with_item(100000)
        agg = _service("agg-rs", Service.Type.ROOM_SERVICE)
        inc_svc.create_inclusion(
            agg.pk,
            {"source_service_id": str(source.pk), "markup_kind": "percent", "markup_value": 1500},
        )
        item = _borrowed_item(_menu("agg-rs", crystal))
        assert item["price"] == 115000  # 100000 + 15%


def test_single_source_of_truth_price_and_stock(crystal):
    with tenant_context(crystal):
        source, _, src_item = _source_with_item(100000)
        agg = _service("agg-rs", Service.Type.ROOM_SERVICE)
        inc_svc.create_inclusion(
            agg.pk,
            {"source_service_id": str(source.pk), "markup_kind": "percent", "markup_value": 1500},
        )
        # Правка ЦЕНЫ в источнике → у заёмщика меняется (ссылка, не копия).
        src_item.price = 200000
        src_item.save(update_fields=["price"])
        assert _borrowed_item(_menu("agg-rs", crystal))["price"] == 230000
        # Стоп-лист источника виден заёмщику.
        src_item.in_stock = False
        src_item.save(update_fields=["in_stock"])
        assert _borrowed_item(_menu("agg-rs", crystal))["is_available"] is False


def test_hidden_items_excluded(crystal):
    with tenant_context(crystal):
        source, category, _ = _source_with_item(100000)
        hidden = Item.objects.create(
            code="src-hidden", category=category, type="product", title={"ru": "Скрыто"}, price=50000
        )
        agg = _service("agg-rs", Service.Type.ROOM_SERVICE)
        inc_svc.create_inclusion(
            agg.pk, {"source_service_id": str(source.pk), "hidden_item_ids": [str(hidden.pk)]}
        )
        cats = {c["code"]: c for c in _menu("agg-rs", crystal)["categories"]}
        codes = {i["code"] for i in cats["src-hot"]["items"]}
        assert "src-steak" in codes and "src-hidden" not in codes


def test_availability_intersection_block_closed(crystal):
    with tenant_context(crystal):
        source, _, _ = _source_with_item(100000)
        agg = _service("agg-rs", Service.Type.ROOM_SERVICE)
        # Расписание блока без интервалов = «никогда» → блок закрыт → позиция
        # заимствования недоступна, хотя у источника всё открыто.
        closed = Schedule.objects.create(name="closed", is_always_open=False)
        inc_svc.create_inclusion(
            agg.pk, {"source_service_id": str(source.pk), "schedule_id": str(closed.pk)}
        )
        assert _borrowed_item(_menu("agg-rs", crystal))["is_available"] is False


def test_resolve_item_executor(crystal):
    with tenant_context(crystal):
        source, _, src_item = _source_with_item(100000)
        agg = _service("agg-rs", Service.Type.ROOM_SERVICE)
        own_cat = Category.objects.create(
            code="agg-own", type="product", title={"ru": "Своё"}, service=agg
        )
        own_item = Item.objects.create(
            code="agg-own-item", category=own_cat, type="product", title={"ru": "X"}, price=10000
        )
        inc_svc.create_inclusion(agg.pk, {"source_service_id": str(source.pk), "executor": "source"})
        # Своя позиция → точка агрегатора; заимствованная → точка источника.
        own_ep, own_inc = inc_svc.resolve_item_executor(agg, own_item)
        assert own_ep == str(agg.execution_point_id) and own_inc is None
        borrowed_ep, borrowed_inc = inc_svc.resolve_item_executor(agg, src_item)
        assert borrowed_ep == str(source.execution_point_id) and borrowed_inc is not None
