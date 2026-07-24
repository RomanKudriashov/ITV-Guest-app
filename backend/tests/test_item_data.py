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
