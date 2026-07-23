"""
CMS-ручки записи коммерции (A3+ шаг 5): настройки отеля, поля категории,
prep_minutes позиции, доставка локации. Контракт — docs/commerce-api-contract.md
(раздел «CMS»). UI строится поверх этих ручек.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db


def _new_item(cms, category_id):
    return cms.post(
        "/api/cms/items",
        {"category_id": category_id, "title": {"ru": "Стейк", "en": "Steak"}, "price": 120000},
    ).json()


def _first_location(cms):
    return cms.get("/api/cms/locations").json()[0]


# --- Настройки коммерции отеля --------------------------------------------


def test_commerce_settings_default_off(cms):
    body = cms.get("/api/cms/commerce-settings").json()
    assert body["service_fee_bp"] == 0
    assert body["tax_bp"] == 0
    assert body["tip_presets"] == []
    assert body["price_round_to_minor"] == 0
    # Валюта нужна UI, чтобы делить/умножать копейки.
    assert body["currency_minor_units"] >= 0


def test_commerce_settings_patch_roundtrip(cms):
    resp = cms.patch(
        "/api/cms/commerce-settings",
        {
            "service_fee_bp": 1000,
            "tax_bp": 2000,
            "tax_inclusive": False,
            "tip_presets": [5, 10, 15],
            "free_delivery_threshold_minor": 500000,
            "price_round_to_minor": 100,
        },
    )
    assert resp.status_code == 200, resp.content
    saved = resp.json()
    assert saved["service_fee_bp"] == 1000
    assert saved["tax_inclusive"] is False
    assert saved["tip_presets"] == [5, 10, 15]

    # Перечитали — те же значения, PATCH записал.
    again = cms.get("/api/cms/commerce-settings").json()
    assert again["tax_bp"] == 2000
    assert again["free_delivery_threshold_minor"] == 500000


def test_commerce_settings_partial_patch_keeps_untouched(cms):
    cms.patch("/api/cms/commerce-settings", {"service_fee_bp": 800})
    cms.patch("/api/cms/commerce-settings", {"tax_bp": 500})
    body = cms.get("/api/cms/commerce-settings").json()
    assert body["service_fee_bp"] == 800  # не сброшен вторым PATCH
    assert body["tax_bp"] == 500


def test_commerce_settings_reject_out_of_range_bp(cms):
    resp = cms.patch("/api/cms/commerce-settings", {"service_fee_bp": 20000})
    assert resp.status_code == 422
    assert resp.json()["code"] == "out_of_range"


def test_commerce_settings_reject_bad_tip_preset(cms):
    resp = cms.patch("/api/cms/commerce-settings", {"tip_presets": [10, 150]})
    assert resp.status_code == 422


def test_commerce_settings_isolated_between_hotels(cms, cms_aurora):
    cms.patch("/api/cms/commerce-settings", {"service_fee_bp": 1200})
    assert cms_aurora.get("/api/cms/commerce-settings").json()["service_fee_bp"] == 0


# --- Категория: сбор и минимум ---------------------------------------------


def test_category_commerce_fields_patch(cms, category_id):
    resp = cms.patch(
        f"/api/cms/categories/{category_id}",
        {"service_fee_applies": False, "min_order_minor": 300000},
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["service_fee_applies"] is False
    assert body["min_order_minor"] == 300000

    # Видно и в дереве категорий (список читает тот же сериализатор).
    tree = cms.get("/api/cms/categories").json()
    node = next(n for n in tree if n["id"] == category_id)
    assert node["min_order_minor"] == 300000


def test_category_min_order_negative_rejected(cms, category_id):
    resp = cms.patch(f"/api/cms/categories/{category_id}", {"min_order_minor": -1})
    assert resp.status_code == 422
    assert resp.json()["code"] == "out_of_range"


# --- Позиция: время подачи -------------------------------------------------


def test_item_prep_minutes_patch_and_clear(cms, category_id):
    item = _new_item(cms, category_id)

    updated = cms.patch(f"/api/cms/items/{item['id']}", {"prep_minutes": 15}).json()
    assert updated["prep_minutes"] == 15

    cleared = cms.patch(f"/api/cms/items/{item['id']}", {"prep_minutes": None}).json()
    assert cleared["prep_minutes"] is None


def test_item_prep_minutes_negative_rejected(cms, category_id):
    item = _new_item(cms, category_id)
    resp = cms.patch(f"/api/cms/items/{item['id']}", {"prep_minutes": -5})
    assert resp.status_code == 422


# --- Локация: стоимость доставки -------------------------------------------


def test_location_delivery_fee_patch(cms):
    location = _first_location(cms)
    resp = cms.patch(f"/api/cms/locations/{location['id']}", {"delivery_fee_minor": 5000})
    assert resp.status_code == 200, resp.content
    assert resp.json()["delivery_fee_minor"] == 5000


def test_location_delivery_fee_negative_rejected(cms):
    location = _first_location(cms)
    resp = cms.patch(f"/api/cms/locations/{location['id']}", {"delivery_fee_minor": -100})
    assert resp.status_code == 422
