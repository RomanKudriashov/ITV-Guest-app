"""
Маркетинговые бейджи: CRUD, назначение, отдача витрине,
универсальность по типам, изоляция тенантов, пресеты за флагом.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Badge, Item
from apps.core.context import tenant_context

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _guest_menu_items(client, hotel, token, type_="product"):
    resp = client.get(
        f"/api/v1/guest/catalog?type={type_}",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    return [item for cat in body.get("categories", []) for item in cat.get("items", [])]


# --- CRUD ------------------------------------------------------------------


def test_badge_crud(cms):
    created = cms.post(
        "/api/v1/cms/badges",
        {"label": {"ru": "Хит", "en": "Hit"}, "color_role": "accent"},
    )
    assert created.status_code == 201, created.content
    badge_id = created.json()["id"]

    listed = cms.get("/api/v1/cms/badges").json()
    assert any(b["id"] == badge_id for b in listed)

    patched = cms.patch(f"/api/v1/cms/badges/{badge_id}", {"color_role": "gold"}).json()
    assert patched["color_role"] == "gold"

    deleted = cms.delete(f"/api/v1/cms/badges/{badge_id}")
    assert deleted.status_code == 200


def test_invalid_color_role_is_rejected(cms):
    resp = cms.post("/api/v1/cms/badges", {"label": {"ru": "X"}, "color_role": "#ff0000"})
    assert resp.status_code == 422
    assert resp.json()["code"] == "invalid_color_role"


# --- Назначение и отдача витрине -------------------------------------------


def test_assigned_badge_reaches_the_guest(client, crystal, cms, guest_token):
    badge = cms.post(
        "/api/v1/cms/badges", {"label": {"ru": "Выбор шефа"}, "color_role": "gold"}
    ).json()
    with tenant_context(crystal):
        caesar_id = str(Item.objects.get(code="caesar").pk)

    cms.put(f"/api/v1/cms/items/{caesar_id}/badges", {"badge_ids": [badge["id"]]})

    items = _guest_menu_items(client, crystal, guest_token)
    caesar = next(i for i in items if i["id"] == caesar_id)
    assert caesar["badges"] == [
        {"label": "Выбор шефа", "color_role": "gold", "sort_order": 0}
    ]
    # Бейджи отдельны от фактических флагов.
    assert "badges" in caesar and "flags" in caesar


def test_assignment_replaces_the_set(client, crystal, cms, guest_token):
    b1 = cms.post("/api/v1/cms/badges", {"label": {"ru": "A"}, "color_role": "accent"}).json()
    b2 = cms.post("/api/v1/cms/badges", {"label": {"ru": "B"}, "color_role": "info"}).json()
    with tenant_context(crystal):
        caesar_id = str(Item.objects.get(code="caesar").pk)

    cms.put(f"/api/v1/cms/items/{caesar_id}/badges", {"badge_ids": [b1["id"]]})
    cms.put(f"/api/v1/cms/items/{caesar_id}/badges", {"badge_ids": [b2["id"]]})

    items = _guest_menu_items(client, crystal, guest_token)
    caesar = next(i for i in items if i["id"] == caesar_id)
    # Замена, а не накопление; join удалён жёстко (иначе дубль по unique).
    assert [b["label"] for b in caesar["badges"]] == ["B"]


def test_badge_on_any_type_no_fork(client, crystal, cms, guest_token):
    """Бейдж вешается на позицию любого типа (info) — ветвления по типу нет."""
    badge = cms.post("/api/v1/cms/badges", {"label": {"ru": "Важное"}, "color_role": "info"}).json()
    with tenant_context(crystal):
        info_item = Item.objects.filter(type="info").first()
        assert info_item is not None
        info_id = str(info_item.pk)

    resp = cms.put(f"/api/v1/cms/items/{info_id}/badges", {"badge_ids": [badge["id"]]})
    assert resp.status_code == 200
    items = _guest_menu_items(client, crystal, guest_token, type_="info")
    info = next(i for i in items if i["id"] == info_id)
    assert info["badges"][0]["label"] == "Важное"


# --- Изоляция --------------------------------------------------------------


def test_badges_isolated_between_hotels(cms, cms_aurora):
    cms.post("/api/v1/cms/badges", {"label": {"ru": "Только-Кристалл"}, "color_role": "accent"})
    aurora_badges = cms_aurora.get("/api/v1/cms/badges").json()
    assert all(b["label"].get("ru") != "Только-Кристалл" for b in aurora_badges)


# --- Пресеты за флагом -----------------------------------------------------


def test_presets_seeded_behind_flag(crystal):
    from django.core.management import call_command

    with tenant_context(crystal):
        assert not Badge.objects.filter(preset="chef_choice").exists()

    call_command("seed_demo_hotel", "--force", "--with-marketing-badges", verbosity=0)
    with tenant_context(crystal):
        codes = set(Badge.objects.exclude(preset="").values_list("preset", flat=True))
    assert {"hit", "new", "chef_choice", "recommended"} <= codes
