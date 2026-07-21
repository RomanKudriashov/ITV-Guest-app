"""CMS: блюда и модификаторы — CRUD, правила, сортировка, стоп-лист."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db


def _new_item(cms, category_id, **overrides):
    payload = {
        "category_id": category_id,
        "title": {"ru": "Том ям", "en": "Tom yum"},
        "description": {"ru": "Острый суп"},
        "price": 78000,
        "flags": ["spicy"],
        "allergens": ["fish"],
        **overrides,
    }
    return cms.post("/api/cms/items", payload)


# --- CRUD ------------------------------------------------------------------


def test_create_and_read_item(cms, category_id):
    response = _new_item(cms, category_id)
    assert response.status_code == 201, response.content
    body = response.json()

    assert body["code"] == "tom-yum"
    assert body["price"] == 78000
    assert body["flags"] == ["spicy"]
    assert body["modifier_groups"] == []

    fetched = cms.get(f"/api/cms/items/{body['id']}").json()
    assert fetched["title"]["ru"] == "Том ям"


def test_list_items_by_category_and_search(cms, category_id):
    _new_item(cms, category_id)
    listed = cms.get(f"/api/cms/items?category_id={category_id}").json()
    codes = {item["code"] for item in listed}
    assert {"ribeye", "tom-yum"} <= codes

    found = cms.get("/api/cms/items?search=Том").json()
    assert [item["code"] for item in found] == ["tom-yum"]


def test_update_item(cms, category_id):
    item = _new_item(cms, category_id).json()
    patched = cms.patch(
        f"/api/cms/items/{item['id']}",
        {"price": 99000, "flags": ["spicy", "popular"], "description": {"en": "Spicy soup"}},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["price"] == 99000
    assert body["flags"] == ["spicy", "popular"]
    assert body["description"] == {"en": "Spicy soup"}


def test_delete_item(cms, category_id):
    item = _new_item(cms, category_id).json()
    assert cms.delete(f"/api/cms/items/{item['id']}").status_code == 200
    assert cms.get(f"/api/cms/items/{item['id']}").status_code == 404


def test_stock_and_toggle(cms, category_id):
    item = _new_item(cms, category_id).json()

    stopped = cms.post(f"/api/cms/items/{item['id']}/stock", {"in_stock": False})
    assert stopped.json()["in_stock"] is False

    hidden = cms.post(f"/api/cms/items/{item['id']}/toggle", {"is_active": False})
    assert hidden.json()["is_active"] is False


def test_reorder_items(cms, category_id):
    _new_item(cms, category_id)
    items = cms.get(f"/api/cms/items?category_id={category_id}").json()
    reversed_ids = list(reversed([item["id"] for item in items]))

    response = cms.post(
        "/api/cms/items/reorder",
        {
            "category_id": category_id,
            "items": [
                {"id": item_id, "sort_order": index}
                for index, item_id in enumerate(reversed_ids)
            ],
        },
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == reversed_ids


def test_reorder_rejects_items_from_another_category(cms, category_id):
    tree = cms.get("/api/cms/categories").json()
    drinks_id = next(n["id"] for n in tree if n["code"] == "drinks")
    foreign = cms.get(f"/api/cms/items?category_id={drinks_id}").json()[0]

    response = cms.post(
        "/api/cms/items/reorder",
        {"category_id": category_id, "items": [{"id": foreign["id"], "sort_order": 0}]},
    )
    assert response.status_code == 422


# --- Валидация -------------------------------------------------------------


@pytest.mark.parametrize(
    "payload,field",
    [
        ({"price": -1}, "price"),
        ({"title": {}}, "title"),
        ({"flags": ["definitely-not-a-flag"]}, "flags"),
        ({"allergens": ["plutonium"]}, "allergens"),
    ],
)
def test_item_validation(cms, category_id, payload, field):
    response = _new_item(cms, category_id, **payload)
    assert response.status_code == 422, response.content
    assert response.json()["field"] == field


def test_item_requires_existing_category(cms):
    response = cms.post(
        "/api/cms/items",
        {"category_id": "00000000-0000-0000-0000-000000000000", "title": {"en": "Ghost"}},
    )
    assert response.status_code == 422
    assert response.json()["field"] == "category_id"


# --- Модификаторы ----------------------------------------------------------


def test_modifier_group_with_options(cms, category_id):
    item = _new_item(cms, category_id).json()

    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {
            "title": {"ru": "Острота", "en": "Spice level"},
            "selection": "single",
            "is_required": True,
            "options": [
                {"title": {"ru": "Слабо"}, "price_delta": 0, "is_default": True},
                {"title": {"ru": "Огонь"}, "price_delta": 5000},
            ],
        },
    )
    assert group.status_code == 201, group.content
    body = group.json()
    assert body["min_choices"] == 1 and body["max_choices"] == 1
    assert len(body["options"]) == 2
    assert [o["price_delta"] for o in body["options"]] == [0, 5000]

    detail = cms.get(f"/api/cms/items/{item['id']}").json()
    assert [g["code"] for g in detail["modifier_groups"]] == ["spice-level"]


def test_single_selection_forces_max_one(cms, category_id):
    item = _new_item(cms, category_id).json()
    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {
            "title": {"en": "Doneness"},
            "selection": "single",
            "max_choices": 5,
            "options": [{"title": {"en": "Medium"}}],
        },
    ).json()
    assert group["max_choices"] == 1


def test_minimum_cannot_exceed_number_of_options(cms, category_id):
    """Нельзя требовать 3 добавки из группы, где их всего одна."""
    item = _new_item(cms, category_id).json()
    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {
            "title": {"en": "Extras"},
            "selection": "multi",
            "max_choices": 5,
            "options": [{"title": {"en": "Pepper"}}],
        },
    ).json()

    response = cms.patch(
        f"/api/cms/modifier-groups/{group['id']}",
        {"is_required": True, "min_choices": 3},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "not_enough_options"


def test_required_group_cannot_stay_empty(cms, category_id):
    """Обязательная группа без вариантов заблокировала бы заказ на кухню."""
    item = _new_item(cms, category_id).json()
    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {"title": {"en": "Sauce"}, "options": [{"title": {"en": "Pepper"}}]},
    ).json()

    made_required = cms.patch(
        f"/api/cms/modifier-groups/{group['id']}", {"is_required": True}
    )
    assert made_required.status_code == 200
    assert made_required.json()["min_choices"] == 1

    option_id = group["options"][0]["id"]
    orphaned = cms.delete(f"/api/cms/modifier-options/{option_id}")
    assert orphaned.status_code == 422
    assert orphaned.json()["code"] == "required_group_empty"


def test_single_group_keeps_one_default_option(cms, category_id):
    item = _new_item(cms, category_id).json()
    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {
            "title": {"en": "Milk"},
            "selection": "single",
            "options": [
                {"title": {"en": "Regular"}, "is_default": True},
                {"title": {"en": "Oat"}, "price_delta": 5000},
            ],
        },
    ).json()

    second = group["options"][1]["id"]
    cms.patch(f"/api/cms/modifier-options/{second}", {"is_default": True})

    refreshed = cms.get(f"/api/cms/items/{item['id']}").json()["modifier_groups"][0]
    defaults = [o["code"] for o in refreshed["options"] if o["is_default"]]
    assert defaults == ["oat"], "в single-группе может быть только один вариант по умолчанию"


def test_modifier_group_and_option_reorder(cms, category_id):
    item = _new_item(cms, category_id).json()
    first = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups",
        {"title": {"en": "A"}, "options": [{"title": {"en": "a1"}}, {"title": {"en": "a2"}}]},
    ).json()
    second = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups", {"title": {"en": "B"}}
    ).json()

    reordered = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups/reorder",
        {"items": [{"id": second["id"], "sort_order": 0}, {"id": first["id"], "sort_order": 1}]},
    ).json()
    assert [g["id"] for g in reordered] == [second["id"], first["id"]]

    option_ids = list(reversed([o["id"] for o in first["options"]]))
    options = cms.post(
        f"/api/cms/modifier-groups/{first['id']}/options/reorder",
        {"items": [{"id": oid, "sort_order": i} for i, oid in enumerate(option_ids)]},
    ).json()
    assert [o["id"] for o in options] == option_ids


def test_delete_modifier_group(cms, category_id):
    item = _new_item(cms, category_id).json()
    group = cms.post(
        f"/api/cms/items/{item['id']}/modifier-groups", {"title": {"en": "Temp"}}
    ).json()

    assert cms.delete(f"/api/cms/modifier-groups/{group['id']}").status_code == 200
    assert cms.get(f"/api/cms/items/{item['id']}").json()["modifier_groups"] == []


def test_seeded_catalog_uses_known_vocabulary_codes(cms):
    """
    Сторож против расхождения сида и справочника: если сид заведёт флаг
    «chef-choice», а словарь знает «chef_choice», CMS откажется сохранять
    такое блюдо — и выяснится это только руками в редакторе.
    """
    from apps.catalog.vocabularies import ALLERGEN_CODES, FLAG_CODES

    for item in cms.get("/api/cms/items").json():
        assert set(item["flags"]) <= FLAG_CODES, f"{item['code']}: {item['flags']}"
        assert set(item["allergens"]) <= ALLERGEN_CODES, f"{item['code']}: {item['allergens']}"
