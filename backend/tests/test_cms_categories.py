"""CMS: категории — CRUD, дерево, сортировка, удаление."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db


def test_tree_lists_seeded_categories(cms):
    tree = cms.get("/api/cms/categories").json()
    codes = [node["code"] for node in tree]
    assert {"hot", "salads", "drinks"} <= set(codes)
    assert all("children" in node for node in tree)
    assert next(n for n in tree if n["code"] == "hot")["items_count"] >= 1


def test_create_category_generates_latin_code_from_cyrillic_title(cms):
    response = cms.post(
        "/api/cms/categories",
        {"title": {"ru": "Десерты", "en": "Desserts"}, "is_active": True},
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["code"] == "desserts"
    assert body["title"]["ru"] == "Десерты"

    # Без английского названия код транслитерируется, а не схлопывается в пустоту.
    only_russian = cms.post("/api/cms/categories", {"title": {"ru": "Выпечка"}})
    assert only_russian.status_code == 201
    assert only_russian.json()["code"] == "vypechka"


def test_create_category_requires_title(cms):
    response = cms.post("/api/cms/categories", {"title": {}})
    assert response.status_code == 422
    assert response.json()["field"] == "title"


def test_update_and_toggle_category(cms, category_id):
    patched = cms.patch(
        f"/api/cms/categories/{category_id}",
        {"title": {"ru": "Горячие блюда", "en": "Hot dishes"}},
    )
    assert patched.status_code == 200
    assert patched.json()["title"]["ru"] == "Горячие блюда"

    toggled = cms.post(f"/api/cms/categories/{category_id}/toggle", {"is_active": False})
    assert toggled.status_code == 200
    assert toggled.json()["is_active"] is False


def test_subcategory_and_cycle_protection(cms, category_id):
    child = cms.post(
        "/api/cms/categories",
        {"title": {"en": "Grill"}, "parent_id": category_id},
    ).json()

    tree = cms.get("/api/cms/categories").json()
    parent_node = next(n for n in tree if n["id"] == category_id)
    assert [c["id"] for c in parent_node["children"]] == [child["id"]]

    # Родитель не может стать потомком собственного ребёнка.
    cycle = cms.patch(f"/api/cms/categories/{category_id}", {"parent_id": child["id"]})
    assert cycle.status_code == 422
    assert cycle.json()["code"] == "cycle_detected"

    # И собственным родителем тоже.
    self_parent = cms.patch(f"/api/cms/categories/{category_id}", {"parent_id": category_id})
    assert self_parent.status_code == 422


def test_reorder_categories(cms):
    tree = cms.get("/api/cms/categories").json()
    reversed_order = list(reversed([node["id"] for node in tree]))

    response = cms.post(
        "/api/cms/categories/reorder",
        {
            "items": [
                {"id": node_id, "parent_id": None, "sort_order": index}
                for index, node_id in enumerate(reversed_order)
            ]
        },
    )
    assert response.status_code == 200
    assert [node["id"] for node in response.json()] == reversed_order
    # И порядок действительно сохранён, а не только отражён в ответе.
    assert [node["id"] for node in cms.get("/api/cms/categories").json()] == reversed_order


def test_reorder_can_move_between_levels(cms, category_id):
    tree = cms.get("/api/cms/categories").json()
    drinks = next(n for n in tree if n["code"] == "drinks")

    response = cms.post(
        "/api/cms/categories/reorder",
        {"items": [{"id": drinks["id"], "parent_id": category_id, "sort_order": 0}]},
    )
    assert response.status_code == 200
    parent_node = next(n for n in response.json() if n["id"] == category_id)
    assert drinks["id"] in [child["id"] for child in parent_node["children"]]


def test_delete_non_empty_category_requires_cascade(cms, category_id):
    conflict = cms.delete(f"/api/cms/categories/{category_id}")
    assert conflict.status_code == 409
    body = conflict.json()
    assert body["code"] == "category_not_empty"
    assert body["items_count"] >= 1

    assert cms.delete(f"/api/cms/categories/{category_id}?cascade=true").status_code == 200

    codes = [node["code"] for node in cms.get("/api/cms/categories").json()]
    assert "hot" not in codes
    # Блюда удалённой категории тоже ушли из списка.
    assert cms.get(f"/api/cms/items?category_id={category_id}").json() == []


def test_delete_empty_category_without_cascade(cms):
    created = cms.post("/api/cms/categories", {"title": {"en": "Empty"}}).json()
    assert cms.delete(f"/api/cms/categories/{created['id']}").status_code == 200
    assert created["id"] not in [n["id"] for n in cms.get("/api/cms/categories").json()]
