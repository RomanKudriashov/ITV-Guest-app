"""
Витрина главной: bento-плитки сервисов (заведения/услуги/инфо), группировка по
порогу, наложение настроек CMS, скоуп по тенанту, и скоуп каталога по заведению.
Контракт — docs/guest-surface-api-contract.md.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, ShowcaseTile

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _home(client, hotel, token):
    return client.get(
        "/api/v1/guest/home", HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()


def _add_restaurant(hotel, code: str):
    """Ещё одно заведение-ресторан: точка kitchen + активная категория на неё."""
    point = ExecutionPoint.objects.create(
        hotel=hotel, code=code, kind=ExecutionPoint.Kind.KITCHEN, title={"ru": code, "en": code}
    )
    category = Category.objects.create(
        hotel=hotel, code=f"{code}-menu", type="product", title={"ru": code, "en": code}, is_active=True
    )
    Route.objects.create(hotel=hotel, category=category, execution_point=point)
    return point


# --- Дефолтная раскладка ---------------------------------------------------


def test_showcase_default_has_venue_service_info_tiles(client, crystal, guest_token):
    home = _home(client, crystal, guest_token)
    tiles = home["tiles"]
    by_type: dict[str, list] = {}
    for tile in tiles:
        by_type.setdefault(tile["type"], []).append(tile)

    # Кухня ресторана — venue; спа — venue; консьерж/хозслужба — venue; + инфо.
    venue_keys = {t["key"] for t in by_type.get("venue", [])}
    assert "kitchen" in venue_keys
    assert "spa" in venue_keys
    assert any(t["type"] == "info" for t in tiles)

    for tile in tiles:
        assert tile["size"] in ("s", "m", "l")
        assert "order" in tile and tile["enabled"] in (True, False)
    # Каждая venue-плитка ведёт в своё заведение.
    for tile in by_type.get("venue", []):
        assert tile["route"] == f"/venue/{tile['key']}"


# --- Группировка по порогу -------------------------------------------------


def test_showcase_venues_separate_at_or_below_threshold(client, crystal, guest_token):
    # crystal по умолчанию: 1 ресторан (kitchen). Добавим ещё 2 → всего 3 = порог.
    with tenant_context(crystal):
        _add_restaurant(crystal, "panorama")
        _add_restaurant(crystal, "asia")
    home = _home(client, crystal, guest_token)
    restaurant_venues = [t for t in home["tiles"] if t["type"] == "venue" and t["kind"] == "kitchen"]
    assert len(restaurant_venues) == 3
    # Свёрнутой плитки-категории ресторанов нет.
    assert not any(t["type"] == "service-category" and t["key"] == "restaurants" for t in home["tiles"])


def test_showcase_groups_restaurants_over_threshold(client, crystal, guest_token):
    # 1 (kitchen) + 4 = 5 ресторанов > порога 3 → одна плитка-категория.
    with tenant_context(crystal):
        for code in ("panorama", "asia", "grill", "lounge"):
            _add_restaurant(crystal, code)
    home = _home(client, crystal, guest_token)
    grouped = [t for t in home["tiles"] if t["type"] == "service-category" and t["key"] == "restaurants"]
    assert len(grouped) == 1
    tile = grouped[0]
    assert tile["venue_count"] == 5
    assert tile["route"] == "/category/restaurants"
    # Отдельных venue-плиток ресторанов больше нет.
    assert not any(t["type"] == "venue" and t["kind"] == "kitchen" for t in home["tiles"])


def test_showcase_threshold_setting_changes_grouping(client, crystal, guest_token):
    with tenant_context(crystal):
        _add_restaurant(crystal, "panorama")  # теперь 2 ресторана
        crystal.showcase_group_threshold = 1
        crystal.save(update_fields=["showcase_group_threshold"])
    home = _home(client, crystal, guest_token)
    # 2 ресторана > порога 1 → свёрнуто.
    assert any(t["type"] == "service-category" and t["key"] == "restaurants" for t in home["tiles"])


# --- Наложение настроек CMS ------------------------------------------------


def test_showcase_tile_overlay_size_order_and_disable(client, crystal, guest_token):
    with tenant_context(crystal):
        ShowcaseTile.objects.create(hotel=crystal, key="kitchen", size="l", sort_order=99)
        ShowcaseTile.objects.create(hotel=crystal, key="spa", is_enabled=False)
    home = _home(client, crystal, guest_token)
    kitchen = next(t for t in home["tiles"] if t["key"] == "kitchen")
    assert kitchen["size"] == "l"
    # Выключенная плитка исчезает.
    assert not any(t["key"] == "spa" for t in home["tiles"])
    # order=99 уводит kitchen в конец.
    assert home["tiles"][-1]["key"] == "kitchen"


# --- Скоуп по тенанту ------------------------------------------------------


def test_showcase_scoped_to_tenant(client, crystal, aurora, guest_token):
    with tenant_context(crystal):
        _add_restaurant(crystal, "crystal-only")
    home = _home(client, crystal, guest_token)
    assert any(t["key"] == "crystal-only" for t in home["tiles"])

    aurora_token = client.post(
        "/api/guest/session",
        data={"room_number": "101"},
        content_type="application/json",
        HTTP_HOST=host_for(aurora),
    ).json().get("token")
    if aurora_token:
        aurora_home = _home(client, aurora, aurora_token)
        assert not any(t["key"] == "crystal-only" for t in aurora_home["tiles"])


# --- Уровень 2: список заведений -------------------------------------------


def test_venues_level2_lists_group(client, crystal, guest_token):
    with tenant_context(crystal):
        _add_restaurant(crystal, "panorama")
    resp = client.get(
        "/api/v1/guest/venues?group=restaurants",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert resp["group"] == "restaurants"
    codes = {v["code"] for v in resp["venues"]}
    assert "kitchen" in codes and "panorama" in codes
    for venue in resp["venues"]:
        assert venue["route"] == f"/venue/{venue['code']}"


# --- Скоуп каталога по заведению -------------------------------------------


def test_catalog_point_filter_scopes_to_venue(client, crystal, guest_token):
    with tenant_context(crystal):
        panorama = _add_restaurant(crystal, "panorama")

    def catalog(query=""):
        return client.get(
            f"/api/v1/guest/catalog?type=product{query}",
            HTTP_HOST=host_for(crystal),
            HTTP_AUTHORIZATION=f"Bearer {guest_token}",
        ).json()

    full = catalog()
    scoped = catalog("&point=panorama")
    full_codes = {c["code"] for c in full["categories"]}
    scoped_codes = {c["code"] for c in scoped["categories"]}

    # Каталог panorama — только её категория, это подмножество полного.
    assert scoped_codes == {"panorama-menu"}
    assert scoped_codes < full_codes
    # Каталог кухни не содержит категорию panorama.
    kitchen = catalog("&point=kitchen")
    assert "panorama-menu" not in {c["code"] for c in kitchen["categories"]}


def test_catalog_unknown_point_is_empty(client, crystal, guest_token):
    resp = client.get(
        "/api/v1/guest/catalog?type=product&point=nope",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert resp["categories"] == []


# --- CMS-редактор витрины --------------------------------------------------


def test_cms_showcase_get_lists_tiles(cms):
    body = cms.get("/api/v1/cms/showcase").json()
    assert body["group_threshold"] == 3
    keys = {t["key"] for t in body["tiles"]}
    assert "kitchen" in keys and "info" in keys
    for tile in body["tiles"]:
        assert tile["size"] in ("s", "m", "l") and "shown" in tile


def test_cms_showcase_zero_threshold_groups(cms):
    # Порог 0 — валидный: всегда сворачивать. `or`-баг съел бы ноль.
    body = cms.put("/api/v1/cms/showcase", {"group_threshold": 0}).json()
    assert body["group_threshold"] == 0
    grouped = {t["key"] for t in body["tiles"] if t["type"] == "service-category"}
    assert "restaurants" in grouped


def test_cms_showcase_size_and_hide_reach_guest(client, crystal, cms, guest_token):
    cms.put(
        "/api/v1/cms/showcase",
        {"tiles": [
            {"key": "kitchen", "size": "s", "sort_order": 2},
            {"key": "spa", "is_enabled": False},
        ]},
    )
    home = client.get(
        "/api/v1/guest/home", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {guest_token}"
    ).json()
    kitchen = next(t for t in home["tiles"] if t["key"] == "kitchen")
    assert kitchen["size"] == "s"
    # Скрытая плитка исчезает из гостевой выдачи, но остаётся в CMS.
    assert not any(t["key"] == "spa" for t in home["tiles"])
    cms_tiles = {t["key"]: t for t in cms.get("/api/v1/cms/showcase").json()["tiles"]}
    assert cms_tiles["spa"]["shown"] is False


def test_cms_showcase_rejects_bad_size(cms):
    resp = cms.put("/api/v1/cms/showcase", {"tiles": [{"key": "kitchen", "size": "xl"}]})
    assert resp.status_code == 422


# --- Заведение ≠ отдел: гостевое имя и видимость -----------------------------


def test_default_guest_facing_rule():
    from apps.hotels.venue_defaults import default_guest_facing

    # Заведение с гостевыми категориями — видимо; служебная хозслужба — нет;
    # точка без категорий — нет.
    assert default_guest_facing("kitchen", has_guest_categories=True) is True
    assert default_guest_facing("housekeeping", has_guest_categories=True) is False
    assert default_guest_facing("kitchen", has_guest_categories=False) is False


def test_showcase_uses_public_name_and_tagline(client, crystal, guest_token):
    home = _home(client, crystal, guest_token)
    kitchen = next(t for t in home["tiles"] if t["key"] == "kitchen")
    # Гостю показываем public_name/tagline, а не служебное «Кухня ресторана».
    assert kitchen["title"] == "Панорама"
    assert kitchen["subtitle"] == "Европейская кухня"


def test_service_point_hidden_even_with_categories(client, crystal, guest_token):
    # Хозслужба служебная (is_guest_facing=false) — плитки не даёт, хотя на неё
    # замаршрутизирована услуга уборки.
    home = _home(client, crystal, guest_token)
    assert not any(t["key"] == "housekeeping" for t in home["tiles"])
    venues = client.get(
        "/api/v1/guest/venues?group=services",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert "housekeeping" not in {v["code"] for v in venues["venues"]}


def test_toggling_guest_facing_shows_and_hides(client, crystal, guest_token):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.create(
            hotel=crystal, code="wine", kind=ExecutionPoint.Kind.BAR,
            title={"ru": "Винотека"}, public_name={"ru": "Винотека"}, is_guest_facing=False,
        )
        category = Category.objects.create(
            hotel=crystal, code="wine-menu", type="product", title={"ru": "Вина"}, is_active=True
        )
        Route.objects.create(hotel=crystal, category=category, execution_point=point)

    def keys():
        return {t["key"] for t in _home(client, crystal, guest_token)["tiles"]}

    assert "wine" not in keys()  # служебная — скрыта
    with tenant_context(crystal):
        point.is_guest_facing = True
        point.save(update_fields=["is_guest_facing"])
    assert "wine" in keys()  # включили — появилась


# --- CMS: гостевые поля отдела ----------------------------------------------


def test_cms_department_exposes_guest_fields(cms):
    departments = cms.get("/api/v1/cms/departments").json()
    kitchen = next(d for d in departments if d["code"] == "kitchen")
    assert kitchen["public_name"]["ru"] == "Панорама"
    assert kitchen["is_guest_facing"] is True
    housekeeping = next(d for d in departments if d["code"] == "housekeeping")
    assert housekeeping["is_guest_facing"] is False


def test_cms_create_department_defaults_public_name_to_title(cms):
    created = cms.post(
        "/api/v1/cms/departments",
        {"title": {"ru": "Пляжный бар"}, "kind": "bar"},
    ).json()
    # Гостевое имя не задано — падает на служебное, точка не безымянна.
    assert created["public_name"]["ru"] == "Пляжный бар"
    assert created["is_guest_facing"] is True

    updated = cms.patch(
        f"/api/v1/cms/departments/{created['id']}",
        {"public_name": {"ru": "У моря"}, "tagline": {"ru": "коктейли на закате"}, "is_guest_facing": False},
    ).json()
    assert updated["public_name"]["ru"] == "У моря"
    assert updated["tagline"]["ru"] == "коктейли на закате"
    assert updated["is_guest_facing"] is False
