"""
Маркетинговые бейджи: CRUD, назначение, отдача витрине,
универсальность по типам, изоляция тенантов, пресеты за флагом.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Badge, Item
from apps.core.context import tenant_context

from tests.conftest import host_for

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

    listed = cms.get("/api/v1/cms/badges").json()["items"]
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
    # Бейджи (маркетинг) отдельны от диет-маркеров позиции.
    assert "badges" in caesar and "markers" in caesar


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


# --- Метка со своей стороны -------------------------------------------------


def test_badge_knows_where_it_hangs(crystal, cms):
    """
    УКУС. «Что у меня помечено как „Хит“» — вопрос со стороны МЕТКИ.

    Связь читалась только со стороны позиции: чтобы ответить, надо было пройти
    весь каталог по одной позиции, а список меток отвечал лишь на «какие метки
    есть». Счётчик и список — здесь.
    """
    badge = cms.post("/api/v1/cms/badges", {"label": {"ru": "Хит"}, "color_role": "gold"}).json()
    assert badge_row(cms, badge["id"])["items_count"] == 0

    with tenant_context(crystal):
        caesar_id = str(Item.objects.get(code="caesar").pk)

    cms.put(f"/api/v1/cms/items/{caesar_id}/badges", {"badge_ids": [badge["id"]]})
    assert badge_row(cms, badge["id"])["items_count"] == 1

    items = cms.get(f"/api/v1/cms/badges/{badge['id']}/items").json()["items"]
    assert [i["id"] for i in items] == [caesar_id]
    # Раздел рядом с именем: одноимённые позиции в разных разделах — обычное
    # дело, и без него список читается как загадка.
    assert items[0]["category"]


def test_badge_pin_and_unpin_do_not_touch_other_badges(crystal, cms):
    """
    Снять СВОЮ метку — не значит стереть чужие.

    `PUT /items/{id}/badges` заменяет весь набор: он про редактор позиции, где
    человек видит все её метки сразу. Со стороны метки разрез обратный, и
    заменять им набор было бы тихой потерей чужой работы.
    """
    hit = cms.post("/api/v1/cms/badges", {"label": {"ru": "Хит"}, "color_role": "gold"}).json()
    spicy = cms.post("/api/v1/cms/badges", {"label": {"ru": "Острое"}, "color_role": "info"}).json()
    with tenant_context(crystal):
        caesar_id = str(Item.objects.get(code="caesar").pk)

    cms.put(f"/api/v1/cms/items/{caesar_id}/badges", {"badge_ids": [hit["id"], spicy["id"]]})

    # Снимаем «Хит» со стороны метки — «Острое» обязано остаться.
    cms.put(f"/api/v1/cms/badges/{hit['id']}/items/{caesar_id}", {"attached": False})
    assert badge_row(cms, hit["id"])["items_count"] == 0
    assert badge_row(cms, spicy["id"])["items_count"] == 1

    # И вешаем обратно — тоже не трогая соседа.
    cms.put(f"/api/v1/cms/badges/{hit['id']}/items/{caesar_id}", {"attached": True})
    assert badge_row(cms, hit["id"])["items_count"] == 1
    assert badge_row(cms, spicy["id"])["items_count"] == 1

    # Повторное «повесить» не плодит дублей.
    cms.put(f"/api/v1/cms/badges/{hit['id']}/items/{caesar_id}", {"attached": True})
    assert badge_row(cms, hit["id"])["items_count"] == 1


def badge_row(cms, badge_id: str) -> dict:
    listed = cms.get("/api/v1/cms/badges").json()["items"]
    return next(b for b in listed if b["id"] == badge_id)


# --- Изоляция --------------------------------------------------------------


def test_badges_isolated_between_hotels(cms, cms_aurora):
    cms.post("/api/v1/cms/badges", {"label": {"ru": "Только-Кристалл"}, "color_role": "accent"})
    aurora_badges = cms_aurora.get("/api/v1/cms/badges").json()["items"]
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
