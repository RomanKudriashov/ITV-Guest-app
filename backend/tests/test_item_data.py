"""
Данные карточки позиции: справочники аллергенов и диетических маркеров
(тенант-словари, засеиваются при провижининге), их язык и скоуп.
Контракт — docs/guest-api-contract.md / cms-api-contract.md.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Allergen, DietaryMarker
from apps.core.context import tenant_context

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _menu(client, hotel, token, lang="ru"):
    return client.get(
        f"/api/v1/guest/catalog?type=product&lang={lang}",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()


def _item(menu, code):
    return next(i for c in menu["categories"] for i in c["items"] if i["code"] == code)


def test_provision_seeds_14_allergens_and_markers(crystal):
    with tenant_context(crystal):
        allergens = list(Allergen.objects.all())
        markers = list(DietaryMarker.objects.all())

    assert len(allergens) == 14
    codes = {a.code for a in allergens}
    assert {"gluten", "peanuts", "molluscs"} <= codes
    assert all(a.is_system for a in allergens)
    # Переводы во всех 4 языках у системных.
    gluten = next(a for a in allergens if a.code == "gluten")
    assert set(gluten.title) >= {"ru", "en", "ar", "zh"}

    marker_codes = {m.code for m in markers}
    # Диетмаркеры — подмножество исторических флагов, БЕЗ маркетинга и вкуса.
    assert {"vegan", "gluten_free", "halal"} <= marker_codes
    assert "spicy" not in marker_codes
    assert "popular" not in marker_codes


def test_seeding_is_idempotent(crystal):
    from apps.hotels.provisioning import seed_item_data_dictionaries

    with tenant_context(crystal):
        seed_item_data_dictionaries()
        seed_item_data_dictionaries()
        assert Allergen.objects.filter(code="gluten").count() == 1
        assert DietaryMarker.objects.filter(code="vegan").count() == 1


def test_dictionaries_scoped_to_tenant(crystal, aurora):
    with tenant_context(crystal):
        Allergen.objects.create(code="crystal_only", title={"ru": "Особый"}, sort_order=99)
    with tenant_context(aurora):
        assert not Allergen.objects.filter(code="crystal_only").exists()


# --- Отдача гостю -----------------------------------------------------------


def test_item_payload_carries_translated_facets(client, crystal, guest_token):
    menu = _menu(client, crystal, guest_token, lang="ru")
    ribeye = _item(menu, "ribeye")
    assert any(m["title"] == "Без глютена" for m in ribeye["markers"])
    assert ribeye["characteristics"]  # пары название→значение
    assert ribeye["nutrition"]["portion"]

    caesar = _item(menu, "caesar")
    assert {"eggs", "milk", "gluten"} <= {a["code"] for a in caesar["allergens"]}


def test_empty_facets_are_empty_not_missing(client, crystal, guest_token):
    # Позиция без маркеров отдаёт пустой список — карточка не рисует блок.
    caesar = _item(_menu(client, crystal, guest_token), "caesar")
    assert caesar["markers"] == []


def test_language_picks_translation_with_english_fallback(client, crystal, guest_token):
    en = _item(_menu(client, crystal, guest_token, lang="en"), "ribeye")
    assert any(m["title"] == "Gluten free" for m in en["markers"])
    # Язык без перевода у системных всё равно даёт значение (фолбэк, не пусто).
    zh = _item(_menu(client, crystal, guest_token, lang="zh"), "caesar")
    assert all(a["title"] for a in zh["allergens"])


# --- CMS: словари и назначение позиции --------------------------------------


def test_cms_lists_system_allergens_and_markers(cms):
    allergens = cms.get("/api/v1/cms/allergens").json()
    assert len([a for a in allergens if a["is_system"]]) == 14
    markers = cms.get("/api/v1/cms/markers").json()
    assert {"vegan", "gluten_free"} <= {m["code"] for m in markers}


def test_cms_custom_allergen_crud_and_system_protected(cms):
    created = cms.post("/api/v1/cms/allergens", {"title": {"ru": "Кориандр", "en": "Coriander"}}).json()
    assert created["is_system"] is False
    cms.patch(f"/api/v1/cms/allergens/{created['id']}", {"is_active": False})
    # Своё — удаляется.
    assert cms.delete(f"/api/v1/cms/allergens/{created['id']}").status_code == 200
    # Системное — нет (409).
    sysid = next(a["id"] for a in cms.get("/api/v1/cms/allergens").json() if a["is_system"])
    resp = cms.delete(f"/api/v1/cms/allergens/{sysid}")
    assert resp.status_code == 409


def test_cms_assign_facets_reaches_guest(client, crystal, cms, guest_token):
    allergens = {a["code"]: a["id"] for a in cms.get("/api/v1/cms/allergens").json()}
    markers = {m["code"]: m["id"] for m in cms.get("/api/v1/cms/markers").json()}
    item = next(
        i for i in cms.get("/api/v1/cms/items").json() if i["code"] == "lemonade"
    )
    cms.patch(
        f"/api/v1/cms/items/{item['id']}",
        {
            "allergen_ids": [allergens["milk"]],
            "marker_ids": [markers["vegan"]],
            "characteristics": [{"name": {"ru": "Подача"}, "value": {"ru": "Со льдом"}}],
        },
    )
    guest = _item(_menu(client, crystal, guest_token, lang="ru"), "lemonade")
    assert [a["code"] for a in guest["allergens"]] == ["milk"]
    assert [m["code"] for m in guest["markers"]] == ["vegan"]
    assert guest["characteristics"][0]["value"] == "Со льдом"
    # CMS-выдача позиции отражает назначенное (для редактора).
    cms_item = next(i for i in cms.get("/api/v1/cms/items").json() if i["code"] == "lemonade")
    assert cms_item["allergen_ids"] == [allergens["milk"]]
    assert cms_item["characteristics"][0]["value"]["ru"] == "Со льдом"


def test_cms_assign_is_idempotent_replace(client, crystal, cms, guest_token):
    markers = {m["code"]: m["id"] for m in cms.get("/api/v1/cms/markers").json()}
    item = next(i for i in cms.get("/api/v1/cms/items").json() if i["code"] == "lemonade")
    for _ in range(2):
        cms.patch(f"/api/v1/cms/items/{item['id']}", {"marker_ids": [markers["vegan"], markers["halal"]]})
    guest = _item(_menu(client, crystal, guest_token), "lemonade")
    assert len(guest["markers"]) == 2  # замена, не накопление дублей


# --- После дропа flags: чипы каталога живы, пустые не ломаются ---------------


def test_catalog_item_carries_markers_for_chips(client, crystal, guest_token):
    # Чипы карточки каталога перешли с flags на markers — позиция их отдаёт.
    lemonade = _item(_menu(client, crystal, guest_token), "lemonade")
    assert any(m["code"] == "vegan" for m in lemonade["markers"])


def test_item_without_facets_does_not_break(client, crystal, cms, guest_token, category_id):
    created = cms.post(
        "/api/cms/items",
        {"category_id": category_id, "title": {"ru": "Вода", "en": "Water"}, "price": 5000},
    ).json()
    assert created["allergen_ids"] == [] and created["marker_ids"] == []
    guest = _item(_menu(client, crystal, guest_token), created["code"])
    assert guest["allergens"] == [] and guest["markers"] == [] and guest["characteristics"] == []
