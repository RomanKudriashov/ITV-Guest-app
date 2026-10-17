"""
ДВА ВИДА МЕНЮ У ГОСТЯ (партия 57): «карточки» и «мозаика».

Сервер хранит две вещи: вид по умолчанию у заведения и отметку «крупно в
мозаике» у позиции; выбор гостя живёт в его браузере и сюда не приходит.
Каждая проверка — укус: на прежнем коде полей нет.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.hotels.models import Service

from tests.catalog.api.test_service_requests import Guest  # noqa: F401  (фикстура guest ниже)
from tests.catalog.api.test_service_requests import guest  # noqa: F401

pytestmark = pytest.mark.django_db


def _service(crystal, type_):
    # Точку — внутри контекста отеля: под RLS вне его она не читается.
    with tenant_context(crystal):
        service = Service.objects.select_related("execution_point").filter(type=type_, is_active=True).first()
        if service is not None:
            service.point_code = service.execution_point.code
        return service


def test_venue_tells_default_menu_view_and_cms_sets_it(cms, guest, crystal):
    """УКУС. Вид по умолчанию: «карточки», CMS ставит «мозаику» — гость её получает."""
    kitchen = _service(crystal, Service.Type.RESTAURANT)
    assert kitchen is not None, "в сиде нет ресторана"
    point = kitchen.point_code
    venue = guest.get(f"/api/guest/catalog?point={point}").json()["venue"]
    assert venue["menu_view"] == "cards"

    row = cms.patch(f"/api/cms/services/{kitchen.pk}", {"menu_view": "mosaic"})
    assert row.status_code == 200, row.content
    assert row.json()["menu_view"] == "mosaic"
    assert row.json()["menu_view_available"] is True
    try:
        venue = guest.get(f"/api/guest/catalog?point={point}").json()["venue"]
        assert venue["menu_view"] == "mosaic"
    finally:
        cms.patch(f"/api/cms/services/{kitchen.pk}", {"menu_view": "cards"})


def test_menu_view_only_for_product_venues(cms, crystal):
    """УКУС. У спа мозаики нет: сервер отказывает, а не сохраняет молча."""
    spa = _service(crystal, Service.Type.SPA)
    if spa is None:
        pytest.skip("в сиде нет спа")
    row = cms.patch(f"/api/cms/services/{spa.pk}", {"menu_view": "mosaic"})
    assert row.status_code == 422 and row.json()["code"] == "menu_view_unsupported"
    bad = cms.patch(f"/api/cms/services/{spa.pk}", {"menu_view": "grid"})
    assert bad.status_code == 422 and bad.json()["code"] == "bad_menu_view"


def test_item_mosaic_large_and_full_image_reach_the_guest(cms, guest, crystal):
    """УКУС. «Крупно в мозаике» ставится в CMS и доезжает до гостя; есть большой кадр для srcset."""
    with tenant_context(crystal):
        item = Item.objects.filter(is_active=True, type="product").first()
    assert item is not None, "в сиде нет товарной позиции"
    row = cms.patch(f"/api/cms/items/{item.pk}", {"mosaic_large": True})
    assert row.status_code == 200, row.content
    assert row.json()["mosaic_large"] is True
    try:
        catalog = guest.get("/api/guest/catalog?type=product").json()
        found = next(i for c in catalog["categories"] for i in c["items"] if i["id"] == str(item.pk))
        assert found["mosaic_large"] is True
        # Большой кадр для srcset: есть фото — адрес, нет — пусто (знак рисует витрина).
        assert "image_full" in found
        detail = guest.get(f"/api/guest/item/{item.pk}").json()
        assert detail["mosaic_large"] is True
    finally:
        cms.patch(f"/api/cms/items/{item.pk}", {"mosaic_large": False})
