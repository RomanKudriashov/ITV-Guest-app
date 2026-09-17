"""
Заведение без каталога (пункт 10 заказчика): ресепшен — отдел без меню и без
коммерции. Разделы, коммерция, витрина и поиск ему не положены; расписание,
персонал и эскалация — остаются.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category
from apps.core.context import tenant_context
from apps.hotels.models import Service

pytestmark = pytest.mark.django_db


def _reception(crystal) -> Service:
    with tenant_context(crystal):
        return Service.objects.get(code="reception")


def test_the_reception_has_no_catalog(cms, crystal):
    reception = _reception(crystal)
    assert reception.has_catalog is False
    body = cms.get(f"/api/cms/services/{reception.pk}").json()
    assert body["has_catalog"] is False


def test_a_new_hotel_gets_its_reception_without_a_catalog(crystal):
    from apps.hotels.services.provisioning import provision_hotel

    hotel = provision_hotel(
        subdomain="nocatalog", name="Без меню", admin_email="a@nocatalog.test", exist_ok=True
    ).hotel
    with tenant_context(hotel):
        assert Service.objects.get(code="reception").has_catalog is False


def test_no_sections_no_commerce_for_a_service_without_a_catalog(cms, crystal):
    reception = _reception(crystal)
    section = cms.post("/api/cms/categories", {"title": {"ru": "Меню ресепшена"}, "service_id": str(reception.pk)})
    assert section.status_code == 422, section.content
    assert section.json()["code"] == "service_without_catalog"

    fee = cms.patch(f"/api/cms/services/{reception.pk}", {"service_fee_bp": 500})
    assert fee.status_code == 422 and fee.json()["code"] == "service_without_catalog"

    # А расписание и имя — пожалуйста.
    assert cms.patch(f"/api/cms/services/{reception.pk}", {"tagline": {"ru": "Круглосуточно"}}).status_code == 200


def test_a_catalog_is_not_dropped_from_a_service_with_sections(cms, crystal):
    with tenant_context(crystal):
        kitchen = Service.objects.get(code="kitchen")
        assert Category.objects.filter(service=kitchen, is_active=True).exists()
    response = cms.patch(f"/api/cms/services/{kitchen.pk}", {"has_catalog": False})
    assert response.status_code == 422 and response.json()["code"] == "service_has_catalog_content"


def test_only_the_admin_switches_the_catalog(client, crystal):
    from tests.conftest import CmsClient, staff_token_for

    manager = CmsClient(client, crystal, staff_token_for(client, crystal, "manager.reception"))
    reception = _reception(crystal)
    assert manager.patch(f"/api/cms/services/{reception.pk}", {"has_catalog": True}).status_code == 403


def test_a_service_without_a_catalog_is_not_on_the_showcase_or_in_search(client, cms, crystal):
    from apps.catalog.models import Item, Route
    from tests.chat.api.test_chat_reviews import guest_for

    with tenant_context(crystal):
        # Раздел, заведённый мимо экрана (данные бывают всякие), — всё равно не витрина.
        reception = Service.objects.get(code="reception")
        category = Category.objects.create(service=reception, code="desk-hidden", title={"ru": "Скрытое"}, type="product")
        Route.objects.create(category=category, execution_point=reception.execution_point)
        Item.objects.create(category=category, code="desk-hidden-item", title={"ru": "Скрытое"}, type="product", price=100)
    guest = guest_for(client, crystal, room="212")
    home = guest.get("/api/guest/home").json()
    assert "reception" not in {tile["key"] for tile in home["tiles"]}, "ресепшена на витрине нет"
    found = guest.get("/api/guest/search?q=Ресепшен").json()
    assert not any(s.get("code") == "reception" for s in found.get("services", [])), found


def test_creating_a_service_without_a_catalog(cms):
    created = cms.post("/api/cms/services", {"type": "concierge", "public_name": {"ru": "Служба гостей"}, "has_catalog": False})
    assert created.status_code == 201, created.content
    assert created.json()["has_catalog"] is False
    plain = cms.post("/api/cms/services", {"type": "restaurant", "public_name": {"ru": "Ещё ресторан"}})
    assert plain.json()["has_catalog"] is True
