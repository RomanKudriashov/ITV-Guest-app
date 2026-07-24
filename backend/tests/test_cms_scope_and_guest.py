"""
CMS: изоляция тенантов на новых эндпоинтах и связка «отредактировал в CMS —
увидел в гостевом меню».

Второе — это Definition of Done: CMS без эффекта в витрине бесполезна.
"""

from __future__ import annotations

import pytest

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Изоляция --------------------------------------------------------------


def test_cms_requires_authentication(client, crystal):
    response = client.get("/api/cms/categories", HTTP_HOST=host_for(crystal))
    assert response.status_code == 401


def test_staff_token_does_not_work_on_another_hotel(client, cms, aurora):
    """JWT сотрудника «Кристалла» на поддомене Aurora — чужой."""
    response = client.get(
        "/api/cms/categories",
        HTTP_HOST=host_for(aurora),
        HTTP_AUTHORIZATION=f"Bearer {cms.token}",
    )
    assert response.status_code == 401


def test_guest_token_cannot_access_cms(client, crystal, guest_token):
    """Гостевой токен — не пропуск в админку, даже в своём отеле."""
    response = client.get(
        "/api/cms/categories",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401


def test_each_hotel_sees_only_its_own_catalog(cms, cms_aurora):
    crystal_items = cms.get("/api/cms/items").json()
    aurora_items = cms_aurora.get("/api/cms/items").json()

    assert crystal_items and aurora_items
    assert {i["id"] for i in crystal_items}.isdisjoint({i["id"] for i in aurora_items})
    # Коды совпадают (общий сид) — а строки разные.
    assert {i["code"] for i in crystal_items} == {i["code"] for i in aurora_items}


def test_cannot_touch_another_hotels_item_by_id(cms, cms_aurora):
    foreign_id = cms_aurora.get("/api/cms/items").json()[0]["id"]

    assert cms.get(f"/api/cms/items/{foreign_id}").status_code == 404
    assert cms.patch(f"/api/cms/items/{foreign_id}", {"price": 1}).status_code == 404
    assert cms.delete(f"/api/cms/items/{foreign_id}").status_code == 404


def test_cannot_move_item_into_another_hotels_category(cms, cms_aurora, category_id):
    foreign_category = cms_aurora.get("/api/cms/categories").json()[0]["id"]
    item = cms.get(f"/api/cms/items?category_id={category_id}").json()[0]

    response = cms.patch(f"/api/cms/items/{item['id']}", {"category_id": foreign_category})
    assert response.status_code == 422
    assert response.json()["field"] == "category_id"


# --- Связка с гостевым меню ------------------------------------------------


def _guest_menu(client, hotel, token, language="ru"):
    return client.get(
        "/api/guest/menu",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_ACCEPT_LANGUAGE=language,
    ).json()


def _find_item(menu, code):
    for category in menu["categories"]:
        for item in category["items"]:
            if item["code"] == code:
                return item
    return None


def test_new_item_appears_in_guest_menu(client, crystal, cms, guest_token, category_id):
    milk_id = next(a["id"] for a in cms.get("/api/v1/cms/allergens").json() if a["code"] == "milk")
    created = cms.post(
        "/api/cms/items",
        {
            "category_id": category_id,
            "title": {"ru": "Борщ", "en": "Borsch"},
            "description": {"ru": "Со сметаной"},
            "price": 42000,
            "allergen_ids": [milk_id],
        },
    ).json()

    cms.post(
        f"/api/cms/items/{created['id']}/modifier-groups",
        {
            "title": {"ru": "Сметана", "en": "Sour cream"},
            "is_required": True,
            "options": [{"title": {"ru": "Да"}, "is_default": True}, {"title": {"ru": "Нет"}}],
        },
    )

    menu = _guest_menu(client, crystal, guest_token)
    item = _find_item(menu, "borsch")
    assert item is not None
    assert item["title"] == "Борщ"
    assert item["price"] == 42000
    # Аллергены отдаются локализованными объектами из словаря (join).
    assert [a["code"] for a in item["allergens"]] == ["milk"]
    assert item["allergens"][0]["title"]
    assert item["has_required_modifiers"] is True

    # Сами группы витрина берёт из карточки блюда, а не из списка меню.
    detail = client.get(
        f"/api/guest/item/{item['id']}",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert detail["modifier_groups"][0]["is_required"] is True
    assert len(detail["modifier_groups"][0]["options"]) == 2

    english = _guest_menu(client, crystal, guest_token, language="en")
    assert _find_item(english, "borsch")["title"] == "Borsch"


def test_stop_list_and_deactivation_reach_guest_menu(client, crystal, cms, guest_token):
    item = cms.get("/api/cms/items?search=ribeye").json()[0]

    cms.post(f"/api/cms/items/{item['id']}/stock", {"in_stock": False})
    guest_item = _find_item(_guest_menu(client, crystal, guest_token), "ribeye")
    assert guest_item["is_available"] is False
    assert guest_item["unavailable_reason"] == "out_of_stock"

    cms.post(f"/api/cms/items/{item['id']}/stock", {"in_stock": True})
    cms.post(f"/api/cms/items/{item['id']}/toggle", {"is_active": False})
    # Выключённая позиция исчезает из витрины совсем, а не гаснет.
    assert _find_item(_guest_menu(client, crystal, guest_token), "ribeye") is None


def test_price_edit_reaches_guest_menu(client, crystal, cms, guest_token):
    item = cms.get("/api/cms/items?search=caesar").json()[0]
    cms.patch(f"/api/cms/items/{item['id']}", {"price": 61000})

    assert _find_item(_guest_menu(client, crystal, guest_token), "caesar")["price"] == 61000


def test_category_toggle_and_reorder_reach_guest_menu(client, crystal, cms):
    session = client.post(
        "/api/guest/session",
        data={"room_number": "201"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]

    tree = cms.get("/api/cms/categories").json()
    drinks = next(node for node in tree if node["code"] == "drinks")
    cms.post(f"/api/cms/categories/{drinks['id']}/toggle", {"is_active": False})

    menu = _guest_menu(client, crystal, session)
    assert "drinks" not in [c["code"] for c in menu["categories"]]

    cms.post(f"/api/cms/categories/{drinks['id']}/toggle", {"is_active": True})
    reversed_ids = list(reversed([node["id"] for node in tree]))
    cms.post(
        "/api/cms/categories/reorder",
        {"items": [{"id": cid, "parent_id": None, "sort_order": i} for i, cid in enumerate(reversed_ids)]},
    )

    menu = _guest_menu(client, crystal, session)
    assert [c["id"] for c in menu["categories"]] == reversed_ids
