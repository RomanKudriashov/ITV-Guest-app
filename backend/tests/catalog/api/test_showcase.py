"""
Витрина главной: bento-плитки сервисов (заведения/услуги/инфо), группировка по
порогу, наложение настроек CMS, скоуп по тенанту, и скоуп каталога по заведению.
Контракт — docs/guest-surface-api-contract.md.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service, ShowcaseTile

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _home(client, hotel, token):
    return client.get(
        "/api/v1/guest/home", HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()


def _add_restaurant(hotel, code: str):
    """Ещё одно заведение-ресторан: сервис + его исполнитель (kitchen) + активная
    категория на него. Заведение на витрине — это Service, поэтому создаём его."""
    point = ExecutionPoint.objects.create(
        hotel=hotel, code=code, kind=ExecutionPoint.Kind.KITCHEN, title={"ru": code, "en": code}
    )
    service = Service.objects.create(
        hotel=hotel, execution_point=point, code=code, type=Service.Type.RESTAURANT,
        public_name={"ru": code, "en": code}, is_guest_facing=True,
    )
    category = Category.objects.create(
        hotel=hotel, code=f"{code}-menu", type="product", title={"ru": code, "en": code},
        is_active=True, service=service,
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

    # Рестораны и бары — всегда одна плитка-группа (партия 29); спа — venue; + инфо.
    venue_keys = {t["key"] for t in by_type.get("venue", [])}
    assert "kitchen" not in venue_keys
    assert any(t["key"] == "restaurants" for t in by_type.get("service-category", []))
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
    """
    Порог решает группы, кроме «Ресторанов и баров» и «В номер» (партия 29): спа
    из двух заведений при пороге 3 — две отдельные плитки, а рестораны (кухня и
    бар, тоже ниже порога) — всё равно одна плитка-группа.
    """
    with tenant_context(crystal):
        _add_service(crystal, "hammam", Service.Type.SPA)
    home = _home(client, crystal, guest_token)
    spa_venues = {t["key"] for t in home["tiles"] if t["type"] == "venue"} & {"spa", "hammam"}
    assert spa_venues == {"spa", "hammam"}
    assert not any(t["type"] == "service-category" and t["key"] == "spa" for t in home["tiles"])
    assert any(t["type"] == "service-category" and t["key"] == "restaurants" for t in home["tiles"])


def test_showcase_groups_restaurants_over_threshold(client, crystal, guest_token):
    # 2 (кухня и бар) + 4 = 6 заведений группы > порога 3 → одна плитка-категория.
    with tenant_context(crystal):
        for code in ("panorama", "asia", "grill", "lounge"):
            _add_restaurant(crystal, code)
    home = _home(client, crystal, guest_token)
    grouped = [t for t in home["tiles"] if t["type"] == "service-category" and t["key"] == "restaurants"]
    assert len(grouped) == 1
    tile = grouped[0]
    assert tile["venue_count"] == 6
    assert tile["route"] == "/category/restaurants"
    # Отдельных venue-плиток ресторанов больше нет.
    assert not any(t["type"] == "venue" and t["kind"] == "kitchen" for t in home["tiles"])


def test_showcase_threshold_setting_changes_grouping(client, crystal, guest_token):
    with tenant_context(crystal):
        _add_restaurant(crystal, "panorama")  # теперь 3: кухня, бар, «Панорама»
        crystal.showcase_group_threshold = 1
        crystal.save(update_fields=["showcase_group_threshold"])
    home = _home(client, crystal, guest_token)
    # 2 ресторана > порога 1 → свёрнуто.
    assert any(t["type"] == "service-category" and t["key"] == "restaurants" for t in home["tiles"])


# --- Наложение настроек CMS ------------------------------------------------


def test_showcase_tile_overlay_size_order_and_disable(client, crystal, guest_token):
    with tenant_context(crystal):
        ShowcaseTile.objects.create(hotel=crystal, key="restaurants", size="s", sort_order=99)
        ShowcaseTile.objects.create(hotel=crystal, key="spa", is_enabled=False)
    home = _home(client, crystal, guest_token)
    restaurants = next(t for t in home["tiles"] if t["key"] == "restaurants")
    assert restaurants["size"] == "s"
    # Выключенная плитка исчезает.
    assert not any(t["key"] == "spa" for t in home["tiles"])
    # order=99 уводит плитку группы в конец.
    assert home["tiles"][-1]["key"] == "restaurants"


# --- Скоуп по тенанту ------------------------------------------------------


def test_showcase_scoped_to_tenant(client, crystal, aurora, guest_token):
    with tenant_context(crystal):
        _add_service(crystal, "crystal-only", Service.Type.SPA)
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
    assert "restaurants" in keys and "info" in keys
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
            {"key": "restaurants", "size": "s", "sort_order": 2},
            {"key": "spa", "is_enabled": False},
        ]},
    )
    home = client.get(
        "/api/v1/guest/home", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {guest_token}"
    ).json()
    restaurants = next(t for t in home["tiles"] if t["key"] == "restaurants")
    assert restaurants["size"] == "s"
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
    # Кухня — в списке группы «Рестораны и бары» (партия 29), её карточка.
    venues = client.get(
        "/api/v1/guest/venues?group=restaurants",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()["venues"]
    kitchen = next(v for v in venues if v["code"] == "kitchen")
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
            hotel=crystal, code="wine", kind=ExecutionPoint.Kind.BAR, title={"ru": "Винотека"},
        )
        service = Service.objects.create(
            hotel=crystal, execution_point=point, code="wine", type=Service.Type.BAR,
            public_name={"ru": "Винотека"}, is_guest_facing=False,
        )
        category = Category.objects.create(
            hotel=crystal, code="wine-menu", type="product", title={"ru": "Вина"},
            is_active=True, service=service,
        )
        Route.objects.create(hotel=crystal, category=category, execution_point=point)

    def keys():
        # Бар — внутри группы «Рестораны и бары» (партия 29): смотрим её список.
        return {
            v["code"]
            for v in client.get(
                "/api/v1/guest/venues?group=restaurants",
                HTTP_HOST=host_for(crystal),
                HTTP_AUTHORIZATION=f"Bearer {guest_token}",
            ).json()["venues"]
        }

    assert "wine" not in keys()  # служебная — скрыта
    with tenant_context(crystal):
        service.is_guest_facing = True
        service.save(update_fields=["is_guest_facing"])
    assert "wine" in keys()  # включили — появилась


# --- CMS: гостевые поля сервиса ---------------------------------------------


def test_cms_service_exposes_guest_fields(cms):
    services = cms.get("/api/v1/cms/services").json()["items"]
    kitchen = next(d for d in services if d["code"] == "kitchen")
    assert kitchen["public_name"]["ru"] == "Панорама"
    assert kitchen["is_guest_facing"] is True
    housekeeping = next(d for d in services if d["code"] == "housekeeping")
    assert housekeeping["is_guest_facing"] is False


def test_cms_create_service_names_its_crew_after_the_venue(cms):
    created = cms.post(
        "/api/v1/cms/services",
        {"type": "bar", "public_name": {"ru": "Пляжный бар"}},
    ).json()
    # Служебное имя бригады = имя заведения, пока отель не задал своё:
    # безымянный отдел в эскалациях и на трекере читается как ошибка.
    assert created["public_name"]["ru"] == "Пляжный бар"
    assert created["execution_point"]["title"]["ru"] == "Пляжный бар"
    assert created["is_guest_facing"] is True

    updated = cms.patch(
        f"/api/v1/cms/services/{created['id']}",
        {"public_name": {"ru": "У моря"}, "tagline": {"ru": "коктейли на закате"}, "is_guest_facing": False},
    ).json()
    assert updated["public_name"]["ru"] == "У моря"
    assert updated["tagline"]["ru"] == "коктейли на закате"
    assert updated["is_guest_facing"] is False


# --- Кадр в шапке каталога --------------------------------------------------


def _catalog(client, hotel, token, offering_type: str, point: str | None = None):
    query = f"?type={offering_type}" + (f"&point={point}" if point else "")
    return client.get(
        f"/api/v1/guest/catalog{query}",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()


@pytest.mark.seed_media
def test_flat_catalog_wears_its_own_cover_not_the_first_venue(crystal, monkeypatch):
    """
    РАЗДЕЛ ОТЕЛЯ НЕ НОСИТ ФОТО ЧУЖОГО ЗАВЕДЕНИЯ.

    «Об отеле» принадлежит отелю, а не заведению, поэтому скоупа по заведению у
    него нет. Раньше в этом случае кадр брался у «первого активного сервиса с
    готовым фото» по алфавиту кода — и в шапку раздела садился снимок бара
    (`bar` идёт первым). Дефект нигде не хранился: кадр считается на каждый
    запрос, поэтому пересев его не лечил, и однажды починенный он вернулся.

    Проверяется ПРАВИЛО, а не конкретная картинка: варианты в тестовом окружении
    не нарезаны, поэтому подменяем адрес меткой ассета — вопрос ведь в том, ЧЕЙ
    снимок выбран, а не как он назван.
    """
    from apps.catalog.services.menu import _catalog_hero_image
    from apps.media.models import MediaAsset

    monkeypatch.setattr(MediaAsset, "url", lambda self, variant=None: f"asset:{self.pk}")

    with tenant_context(crystal):
        info_category = (
            Category.objects.filter(type="info", is_active=True, image__isnull=False)
            .select_related("image")
            .order_by("sort_order", "code")
            .first()
        )
        assert info_category is not None, "у демо-отеля нет инфо-раздела с обложкой"
        venue_covers = {
            f"asset:{service.image_id}"
            for service in Service.objects.filter(is_active=True, image__isnull=False)
        }
        hero = _catalog_hero_image(None, "info")

    assert hero == f"asset:{info_category.image_id}", "шапка раздела показывает не свою обложку"
    assert hero not in venue_covers, "в шапке раздела снимок заведения"


@pytest.mark.seed_media
def test_venue_catalog_still_wears_the_venue_photo(crystal, monkeypatch):
    """Скоуп по заведению не сломан: там кадр как раз обязан быть его."""
    from apps.catalog.services.menu import _catalog_hero_image
    from apps.media.models import MediaAsset

    monkeypatch.setattr(MediaAsset, "url", lambda self, variant=None: f"asset:{self.pk}")

    with tenant_context(crystal):
        service = Service.objects.filter(is_active=True, image__isnull=False, code="bar").first()
        assert service is not None
        hero = _catalog_hero_image("bar", "product")

    assert hero == f"asset:{service.image_id}"


# --- Группы по типу сервиса (партия 29) --------------------------------------


def _add_service(hotel, code: str, service_type: str):
    """Заведение заданного типа — сервис, его исполнитель и активная категория."""
    point = ExecutionPoint.objects.create(
        hotel=hotel, code=code, kind=ExecutionPoint.Kind.KITCHEN, title={"ru": code, "en": code}
    )
    service = Service.objects.create(
        hotel=hotel, execution_point=point, code=code, type=service_type,
        public_name={"ru": code, "en": code}, is_guest_facing=True,
    )
    category = Category.objects.create(
        hotel=hotel, code=f"{code}-menu", type="product", title={"ru": code, "en": code},
        is_active=True, service=service,
    )
    Route.objects.create(hotel=hotel, category=category, execution_point=point)
    return service


def _always_group(hotel):
    hotel.showcase_group_threshold = 0
    hotel.save(update_fields=["showcase_group_threshold"])


def test_in_room_services_are_their_own_group_not_restaurants(client, crystal, guest_token):
    """Рум-сервис и мини-бар — «В номер», ресторан и бар — «Рестораны и бары»."""
    with tenant_context(crystal):
        _add_service(crystal, "rs", Service.Type.ROOM_SERVICE)
        _add_service(crystal, "mb", Service.Type.MINIBAR)
        _always_group(crystal)
    tiles = {t["key"]: t for t in _home(client, crystal, guest_token)["tiles"] if t["type"] == "service-category"}
    assert tiles["in_room"]["venue_count"] == 2
    assert tiles["in_room"]["route"] == "/category/in_room"
    assert tiles["in_room"]["title"] == "В номер"
    assert tiles["restaurants"]["title"] == "Рестораны и бары"

    def listed(group):
        return {
            v["code"]
            for v in client.get(
                f"/api/v1/guest/venues?group={group}",
                HTTP_HOST=host_for(crystal),
                HTTP_AUTHORIZATION=f"Bearer {guest_token}",
            ).json()["venues"]
        }

    assert listed("in_room") == {"rs", "mb"}
    assert not {"rs", "mb"} & listed("restaurants"), "мини-бар больше не среди ресторанов"


def test_group_titles_are_in_four_languages(crystal):
    from apps.catalog.services.showcase import build_showcase

    with tenant_context(crystal):
        _add_service(crystal, "rs", Service.Type.ROOM_SERVICE)
        _always_group(crystal)
        titles = {
            language: {t["key"]: t["title"] for t in build_showcase(crystal, language=language)}
            for language in ("ru", "en", "ar", "zh")
        }
    assert {lang: t["restaurants"] for lang, t in titles.items()} == {
        "ru": "Рестораны и бары",
        "en": "Restaurants & bars",
        "ar": "المطاعم والبارات",
        "zh": "餐厅与酒吧",
    }
    assert {lang: t["in_room"] for lang, t in titles.items()} == {
        "ru": "В номер",
        "en": "In-room",
        "ar": "إلى الغرفة",
        "zh": "送至客房",
    }


def test_a_group_of_one_service_goes_straight_into_it(client, crystal, guest_token):
    """Свёрнутая группа из одного заведения — плитка ведёт сразу в него, без списка."""
    with tenant_context(crystal):
        _add_service(crystal, "rs", Service.Type.ROOM_SERVICE)
        _always_group(crystal)
    tile = next(t for t in _home(client, crystal, guest_token)["tiles"] if t["key"] == "in_room")
    assert (tile["type"], tile["venue_count"], tile["route"]) == ("service-category", 1, "/venue/rs")
    # Группа из нескольких — по-прежнему список.
    restaurants = next(t for t in _home(client, crystal, guest_token)["tiles"] if t["key"] == "restaurants")
    assert restaurants["route"] == "/category/restaurants"


def test_catalog_items_carry_their_venue_type(client, crystal, guest_token):
    """
    Партия 29: позиция знает тип заведения своего раздела — по нему витрина
    рисует заглушку без фото (у товара хозслужбы — не «вилка и нож»).
    """
    with tenant_context(crystal):
        service = _add_service(crystal, "linen", Service.Type.HOUSEKEEPING)
        from apps.catalog.models import Item

        category = Category.objects.get(code="linen-menu")
        Item.objects.create(
            hotel=crystal, category=category, code="pillow", type="product",
            title={"ru": "Подушка", "en": "Pillow"}, price=0, is_active=True,
        )
        assert service.type == Service.Type.HOUSEKEEPING
    catalog = client.get(
        "/api/v1/guest/catalog?type=product&point=linen",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    items = {i["code"]: i for c in catalog["categories"] for i in c["items"]}
    assert items["pillow"]["service_type"] == "housekeeping"
    kitchen = client.get(
        "/api/v1/guest/catalog?type=product&point=kitchen",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert {i["service_type"] for c in kitchen["categories"] for i in c["items"]} == {"restaurant"}


def test_item_card_also_carries_the_venue_type(client, crystal, guest_token):
    """Карточка позиции (шторка) — тот же `service_type`: схема ответа его не режет."""
    catalog = client.get(
        "/api/v1/guest/catalog?type=product&point=kitchen",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    item_id = catalog["categories"][0]["items"][0]["id"]
    card = client.get(
        f"/api/v1/guest/item/{item_id}", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {guest_token}"
    ).json()
    assert card["service_type"] == "restaurant"


def test_no_server_placeholder_for_items_without_a_photo(client, crystal, guest_token):
    """
    П.61 (партия 29): у позиции без фото — пустой список, а не адрес заглушки
    `/static/placeholders/…`, которой нет (локально 404, на стенде `index.html`).
    Знак без фото рисует витрина по типу заведения.
    """
    from apps.catalog.models import Item

    with tenant_context(crystal):
        _add_service(crystal, "linen", Service.Type.HOUSEKEEPING)
        Item.objects.create(
            hotel=crystal, category=Category.objects.get(code="linen-menu"), code="pillow", type="product",
            title={"ru": "Подушка", "en": "Pillow"}, price=0, is_active=True,
        )
    auth = {"HTTP_HOST": host_for(crystal), "HTTP_AUTHORIZATION": f"Bearer {guest_token}"}
    response = client.get("/api/v1/guest/catalog?type=product&point=linen", **auth)
    items = {i["code"]: i for c in response.json()["categories"] for i in c["items"]}
    assert items["pillow"]["images"] == []
    card = client.get(f"/api/v1/guest/item/{items['pillow']['id']}", **auth)
    assert card.json()["images"] == []
    assert "placeholders/" not in response.content.decode() + card.content.decode()


def test_restaurants_and_in_room_are_one_tile_regardless_of_threshold(client, crystal, guest_token):
    """
    Решение заказчика (партия 29): «Рестораны и бары» и «В номер» — одна плитка
    при двух сервисах и больше, какой бы ни был порог; один сервис — плитка
    ведёт сразу в него. Порог отеля — 8: раньше при нём рестораны стояли
    отдельными плитками.
    """
    with tenant_context(crystal):
        crystal.showcase_group_threshold = 8
        crystal.save(update_fields=["showcase_group_threshold"])
        _add_service(crystal, "rs", Service.Type.ROOM_SERVICE)

    tiles = {t["key"]: t for t in _home(client, crystal, guest_token)["tiles"]}
    assert tiles["restaurants"]["type"] == "service-category"
    assert tiles["restaurants"]["route"] == "/category/restaurants"
    assert "kitchen" not in tiles and "bar" not in tiles, "рестораны не отдельными плитками"
    one = tiles["in_room"]
    assert (one["venue_count"], one["route"]) == (1, "/venue/rs"), "один сервис — сразу в него"

    with tenant_context(crystal):
        _add_service(crystal, "mb", Service.Type.MINIBAR)
    tiles = {t["key"]: t for t in _home(client, crystal, guest_token)["tiles"]}
    assert (tiles["in_room"]["venue_count"], tiles["in_room"]["route"]) == (2, "/category/in_room")
    assert "rs" not in tiles and "mb" not in tiles
