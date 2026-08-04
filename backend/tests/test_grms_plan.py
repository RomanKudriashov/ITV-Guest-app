"""
План-двойник номера: геометрия в снимке, картинка — из медиапайплайна.

Что здесь доказывается и почему именно это:

  * КООРДИНАТЫ НЕ ПОДГОНЯЮТСЯ. В конфиг уезжают ровно те числа, что замерены
    по стенам рендера (docs/design/grms-concept/plan-geometry.json). Проверка
    посимвольная: «поправил на глаз» разводит разметку с картинкой на глазах у
    гостя, и заметно это становится только на чужом стенде.

  * ОТКАТ ВОЗВРАЩАЕТ ГЕОМЕТРИЮ СВОЕЙ ВЕРСИИ. Ради этого план и лежит ВНУТРИ
    снимка: с отдельной таблицей откат конфигурации оставил бы новую разметку
    поверх старых элементов, то есть точки управления оказались бы не там, где
    оборудование.

  * НА ПЛАНЕ НЕТ ТОЧКИ, ЗА КОТОРОЙ НЕТ ЭЛЕМЕНТА. То же правило, по которому
    непривязанный элемент не попадает в снимок.

  * ТИП БЕЗ ПЛАНА — ШТАТНЫЙ СЛУЧАЙ, а не авария: снимок собирается, гостю
    уходит экран со списком контролов.
"""

from __future__ import annotations

import json

import pytest
from django.core.management import call_command

from apps.core.context import tenant_context
from apps.grms import plan as plan_geometry
from apps.grms import publishing
from apps.grms.management.commands.seed_grms_demo import GEOMETRY_FILE, TYPE_CODE
from apps.grms.models import PublishedConfig, RoomType
from apps.media.models import MediaAsset

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


@pytest.fixture
def seeded(crystal, settings):
    """
    Демо-конфигурация с планом. Celery в этом прогоне синхронный: без нарезки
    вариантов ассет остаётся PENDING, а такой план гостю не отдаётся вовсе —
    и половина проверок ниже проверяла бы отсутствие плана.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True
    call_command("seed_grms_demo", subdomain=crystal.subdomain, verbosity=0)
    return crystal


def _current(hotel) -> dict:
    with tenant_context(hotel):
        config = PublishedConfig.objects.filter(
            room_type__code=TYPE_CODE, is_current=True
        ).first()
        return config.payload


def _type(hotel) -> RoomType:
    with tenant_context(hotel):
        return RoomType.objects.get(code=TYPE_CODE)


# --- Замеры -----------------------------------------------------------------


def test_geometry_reaches_the_snapshot_exactly_as_measured(seeded):
    """
    Числа из файла замеров — в снимке БЕЗ единой правки.

    Сравниваем поимённо, а не «примерно похоже»: смысл замеров в том, что они
    сняты по стенам конкретного кадра, и любое «округлил» здесь означает маску
    света, съехавшую с комнаты.
    """
    measured = json.loads(GEOMETRY_FILE.read_text(encoding="utf-8"))
    plan = _current(seeded)["plan"]

    assert plan["aspect"] == measured["aspect"]

    zones = {zone["code"]: zone for zone in plan["zones"]}
    for source in measured["zones"]:
        zone = zones[source["code"]]
        assert zone["hit"] == source["hit"], source["code"]
        assert zone["mask"] == source["mask"], source["code"]

    windows = {window["code"]: window for window in plan["windows"]}
    for source in measured["windows"]:
        window = windows[source["code"]]
        for key in ("x", "y", "w", "h"):
            assert window[key] == source[key], f"{source['code']}.{key}"
        # Вертикальное окно на боковой стене собирает полотна вверх и вниз —
        # признак обязан доехать, иначе оно поедет как горизонтальное.
        assert window["orientation"] == source["orientation"], source["code"]

    assert plan["points"] == [
        {"controlId": "ac.1", "x": measured["ac"]["x"], "y": measured["ac"]["y"]}
    ]


def test_zone_codes_match_the_published_zones(seeded):
    """Коды зон плана и коды зон конфигурации — одни и те же, без переименований."""
    payload = _current(seeded)
    published = {zone["code"] for zone in payload["zones"]}
    for zone in payload["plan"]["zones"]:
        assert zone["code"] in published, zone["code"]


# --- Версии и откат ---------------------------------------------------------


def test_rollback_returns_the_geometry_of_its_own_version(seeded):
    """
    Откат к v1 возвращает РАЗМЕТКУ v1, а не «v1 плюс сегодняшние правки».

    Это и есть причина, по которой план лежит внутри снимка: элементы и точки
    управления ими обязаны откатываться вместе, иначе кнопка окажется не над
    тем оборудованием.
    """
    hotel = seeded
    first = _current(hotel)["plan"]
    assert first["zones"]

    room_type = _type(hotel)
    moved = json.loads(json.dumps(room_type.plan))
    moved["zones"][0]["hit"]["x"] += 12.5
    with tenant_context(hotel):
        RoomType.objects.filter(pk=room_type.pk).update(plan=moved)

    second = publishing.publish(hotel, TYPE_CODE)
    assert second.payload["plan"]["zones"][0]["hit"]["x"] == first["zones"][0]["hit"]["x"] + 12.5

    third = publishing.rollback(hotel, TYPE_CODE, to_version=second.version - 1)
    assert third.payload["plan"] == first
    # Черновик при этом НЕ переписан: откат публикует копию старой версии, а не
    # правит справочники задним числом.
    assert _type(hotel).plan["zones"][0]["hit"]["x"] == moved["zones"][0]["hit"]["x"]


def test_publish_drops_plan_points_without_a_published_element(seeded):
    """
    Ссылка на элемент, которого в этой версии нет, с плана уходит.

    Кликабельная комната без канала — это обещание без исполнителя, ровно то
    же, из-за чего непривязанный элемент не попадает в снимок.
    """
    hotel = seeded
    room_type = _type(hotel)
    broken = json.loads(json.dumps(room_type.plan))
    broken["zones"][0]["controlId"] = "light.nowhere"
    broken["windows"][0]["curtainId"] = "curtain.nowhere"
    broken["points"][0]["controlId"] = "ac.nowhere"
    with tenant_context(hotel):
        RoomType.objects.filter(pk=room_type.pk).update(plan=broken)

    plan = publishing.publish(hotel, TYPE_CODE).payload["plan"]

    assert "light.nowhere" not in [zone["controlId"] for zone in plan["zones"]]
    assert len(plan["zones"]) == len(broken["zones"]) - 1
    assert [window["code"] for window in plan["windows"]] == [
        window["code"] for window in broken["windows"][1:]
    ]
    assert plan["points"] == []


def test_a_type_without_a_plan_publishes_without_one(seeded):
    """
    Плана нет — снимок собирается, публикация проходит, план пуст.

    Это штатный сценарий, а не крайний случай: у большинства типов номера
    рендера не будет вовсе, и экран обязан работать списком контролов.
    """
    hotel = seeded
    with tenant_context(hotel):
        RoomType.objects.filter(code=TYPE_CODE).update(plan={})

    config = publishing.publish(hotel, TYPE_CODE)

    assert config.payload["plan"] == {}
    assert config.payload["zones"], "без плана снимок обязан остаться прежним"


# --- Картинка ---------------------------------------------------------------


def test_the_server_resolves_both_frames_and_hands_out_ready_urls(seeded):
    """
    Гость получает АДРЕСА, а не идентификаторы записей: адрес зависит от
    варианта, готовности нарезки и настроек стенда, и собранный на фронте он
    ломается ровно там, где его некому чинить.
    """
    hotel = seeded
    plan = _current(hotel)["plan"]
    with tenant_context(hotel):
        asset = MediaAsset.objects.get(pk=plan["asset_id"])
        off_asset = MediaAsset.objects.get(pk=plan["asset_off_id"])
        assert {asset.kind, off_asset.kind} == {MediaAsset.Kind.ROOM_PLAN}
        assert asset.status == off_asset.status == MediaAsset.Status.READY
        exposed = plan_geometry.for_guest(plan)

    assert exposed["image"] == asset.url(plan_geometry.PLATE_VARIANT)
    assert exposed["image_off"] == off_asset.url(plan_geometry.PLATE_VARIANT)
    assert exposed["image"].startswith("http")
    # Два РАЗНЫХ кадра: ночной посчитан из светлого, но это отдельный объект.
    assert exposed["image_off"] != exposed["image"]
    assert "asset_id" not in exposed and "asset_off_id" not in exposed
    assert exposed["aspect"] == plan["aspect"]


def test_the_night_frame_is_pixel_aligned_with_the_lit_one(seeded):
    """
    Кадры совпадают по размеру — иначе на границе включённой зоны поедет мебель.

    Ночной кадр не рисуется отдельно, а СЧИТАЕТСЯ из светлого
    (docs/design/grms-concept/bake_dark_plate.py), поэтому совмещение здесь —
    свойство, а не удача; проверка стоит на случай, если кадр однажды подменят
    руками.
    """
    hotel = seeded
    plan = _current(hotel)["plan"]
    with tenant_context(hotel):
        lit = MediaAsset.objects.get(pk=plan["asset_id"])
        off = MediaAsset.objects.get(pk=plan["asset_off_id"])
    assert (lit.width, lit.height) == (off.width, off.height)


def test_a_type_without_a_night_frame_still_gets_a_plan(seeded):
    """
    Ночного кадра нет — план остаётся, плита работает затемняющей маской.

    Это запасной путь для типа, которому кадр не посчитали: показать план
    хуже, чем с двумя кадрами, но лучше, чем не показать вовсе.
    """
    hotel = seeded
    plan = dict(_current(hotel)["plan"], asset_off_id="")
    with tenant_context(hotel):
        exposed = plan_geometry.for_guest(plan)

    assert exposed["image"]
    assert exposed["image_off"] == ""
    assert exposed["zones"]


def test_an_unprocessed_asset_means_no_plan_at_all(seeded):
    """
    Варианты ещё не нарезаны — плана нет вовсе.

    Не пустая рамка и не битая картинка: экран в этом случае работает списком,
    как у типа без плана. Заглушку сюда ставить нельзя — она соврала бы, что
    план у номера какой-то есть.
    """
    hotel = seeded
    plan = _current(hotel)["plan"]
    with tenant_context(hotel):
        MediaAsset.objects.filter(pk=plan["asset_id"]).update(
            status=MediaAsset.Status.PENDING, variants={}
        )
        assert plan_geometry.for_guest(plan) == {}


def test_a_broken_asset_reference_does_not_crash_the_snapshot(seeded):
    """Мусор в конфиге — экран со списком, а не 500 гостю."""
    hotel = seeded
    plan = dict(_current(hotel)["plan"], asset_id="не-uuid")
    with tenant_context(hotel):
        assert plan_geometry.for_guest(plan) == {}


# --- Идемпотентность --------------------------------------------------------


def test_reseeding_neither_duplicates_the_asset_nor_bumps_the_version(seeded):
    """
    Повторный сид не грузит второй рендер и не плодит версию.

    История публикаций — единственный ответ на вопрос «почему в номере
    перестал работать свет»; версия на каждый прогон сида превращает её в шум.
    """
    hotel = seeded
    before = _current(hotel)
    with tenant_context(hotel):
        assets = MediaAsset.objects.filter(kind=MediaAsset.Kind.ROOM_PLAN).count()
    # Кадра два — светлый и ночной, и повторный сид не делает из них четыре.
    assert assets == 2

    call_command("seed_grms_demo", subdomain=hotel.subdomain, verbosity=0)

    with tenant_context(hotel):
        assert MediaAsset.objects.filter(kind=MediaAsset.Kind.ROOM_PLAN).count() == assets
        assert PublishedConfig.objects.filter(room_type__code=TYPE_CODE).count() == 1
    assert _current(hotel) == before
