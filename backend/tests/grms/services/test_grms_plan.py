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

from apps.core.models import AuditLog

# Кто нажал — в этих проверках неважно: они про механику публикации,
# а не про владельца действия. Называем систему, а не выдумываем человека.
SYSTEM_ACTOR = AuditLog.ActorType.SYSTEM

import json

import pytest
from django.core.management import call_command

from apps.core.context import tenant_context
from apps.grms.services import plan as plan_geometry
from apps.grms.services import publishing
from apps.grms.management.commands.seed_grms_demo import (
    GEOMETRY_FILE,
    PLAN_ZONE_LIGHTS,
    TYPE_CODE,
)
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

    # Точки плана — это И поток воздуха, И метки света: формат один, а чем
    # окажется точка, решает элемент, на который она ссылается. Координаты
    # обеих групп берутся из файла замеров без единой правки.
    # Направление струи — тоже ЗАМЕР, а не умолчание кода: фанкойл висит на
    # стене, и сторону задаёт тот, кто размечал план. Точкам света поле
    # безразлично, у них остаётся общее умолчание.
    expected_points = [
        {
            "controlId": "ac.1",
            "x": measured["ac"]["x"],
            "y": measured["ac"]["y"],
            "dir": measured["ac"]["dir"],
        }
    ] + [
        {
            "controlId": PLAN_ZONE_LIGHTS[light["zone"]],
            "x": light["x"],
            "y": light["y"],
            "dir": "down",
        }
        for light in measured.get("lights", [])
        if light["zone"] in PLAN_ZONE_LIGHTS
    ]
    assert plan["points"] == expected_points


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

    second = publishing.publish(hotel, TYPE_CODE, actor_type=SYSTEM_ACTOR)
    assert second.payload["plan"]["zones"][0]["hit"]["x"] == first["zones"][0]["hit"]["x"] + 12.5

    third = publishing.rollback(hotel, TYPE_CODE, to_version=second.version - 1, actor_type=SYSTEM_ACTOR)
    assert third.payload["plan"] == first
    # Черновик при этом НЕ переписан: откат публикует копию старой версии, а не
    # правит справочники задним числом.
    assert _type(hotel).plan["zones"][0]["hit"]["x"] == moved["zones"][0]["hit"]["x"]


def test_publish_is_blocked_when_the_plan_points_at_a_missing_element(seeded):
    """
    Ссылка разметки в пустоту БЛОКИРУЕТ публикацию — и называет, чего нет.

    Раньше такие ссылки молча выбрасывались. Это было хуже: администратор
    разметил зону, потом снял или переименовал элемент — зона на плане
    перестала быть кликабельной, а он об этом не узнал. Ошибку нашли бы в
    номере, причём не он.
    """
    from apps.core.errors import ValidationError

    hotel = seeded
    room_type = _type(hotel)
    broken = json.loads(json.dumps(room_type.plan))
    broken["zones"][0]["controlId"] = "light.nowhere"
    with tenant_context(hotel):
        RoomType.objects.filter(pk=room_type.pk).update(plan=broken)

    with pytest.raises(ValidationError) as failure:
        publishing.publish(hotel, TYPE_CODE, actor_type=SYSTEM_ACTOR)
    assert "light.nowhere" in str(failure.value)

    # Опубликованная версия при этом осталась прежней: неудачная публикация
    # ничего не меняет в номере.
    assert _current(hotel)["plan"]["zones"][0]["controlId"] == "light.living"


def test_publish_is_blocked_when_a_zone_has_no_element_at_all(seeded):
    """Зона без привязки — та же поломка, только заметить её ещё труднее."""
    from apps.core.errors import ValidationError

    hotel = seeded
    room_type = _type(hotel)
    empty = json.loads(json.dumps(room_type.plan))
    empty["zones"][0]["controlId"] = ""
    with tenant_context(hotel):
        RoomType.objects.filter(pk=room_type.pk).update(plan=empty)

    with pytest.raises(ValidationError) as failure:
        publishing.publish(hotel, TYPE_CODE, actor_type=SYSTEM_ACTOR)
    assert "зоны без рабочего элемента" in str(failure.value)


def test_a_type_without_a_plan_publishes_without_one(seeded):
    """
    Плана нет — снимок собирается, публикация проходит, план пуст.

    Это штатный сценарий, а не крайний случай: у большинства типов номера
    рендера не будет вовсе, и экран обязан работать списком контролов.
    """
    hotel = seeded
    with tenant_context(hotel):
        RoomType.objects.filter(code=TYPE_CODE).update(plan={})

    config = publishing.publish(hotel, TYPE_CODE, actor_type=SYSTEM_ACTOR)

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


# --- Зеркальная планировка --------------------------------------------------


def test_mirrored_layout_travels_to_the_guest(seeded):
    """
    Номера по разные стороны коридора — одна планировка, отражённая. Флажок
    едет гостю ЧЕРЕЗ СНИМОК, как и вся геометрия: иначе он остался бы в
    черновике и не пережил бы откат.

    Координаты при этом НЕ пересчитываются: отражается плита целиком, кадры
    вместе с разметкой. Пересчёт координат был бы вторым источником истины,
    который разойдётся с первым на первой же правке.
    """
    room_type = _type(seeded)
    with tenant_context(seeded):
        draft = dict(room_type.plan or {})
        draft["mirrored"] = True
        room_type.plan = draft
        room_type.save(update_fields=["plan", "updated_at"])

    publishing.publish(seeded, TYPE_CODE, actor_type=SYSTEM_ACTOR)
    payload = _current(seeded)
    assert payload["plan"]["mirrored"] is True

    with tenant_context(seeded):
        for_guest = plan_geometry.for_guest(payload["plan"])
    assert for_guest["mirrored"] is True
    # Ни один прямоугольник не сдвинулся.
    assert for_guest["zones"][0]["hit"] == payload["plan"]["zones"][0]["hit"]


def test_a_plan_without_the_flag_is_not_mirrored(seeded):
    payload = _current(seeded)
    assert payload["plan"]["mirrored"] is False
    with tenant_context(seeded):
        assert plan_geometry.for_guest(payload["plan"])["mirrored"] is False


# --- Двое пишут в один план -------------------------------------------------


def test_night_frame_does_not_wipe_zones_drawn_while_it_was_baking(seeded):
    """
    Ночной кадр считается СЕКУНДЫ, и всё это время администратор размечает
    план: обвести зону сразу после загрузки кадра — обычный ход работы, а не
    редкое совпадение.

    Раньше оба писателя читали план целиком, меняли своё поле и писали обратно
    своей копией: задача, прочитавшая план ДО сохранения разметки, затирала
    только что обведённые зоны — тихо, без ошибки, и администратор узнавал об
    этом, когда план оказывался пустым. Ниже воспроизведён ровно этот порядок:
    читаем план в «задачу», сохраняем зону из «редактора», и только потом
    задача дописывает свой кадр.
    """
    room_type = _type(seeded)
    with tenant_context(seeded):
        # Копия плана «в руках» задачи: прочитана ДО того, как редактор сохранил
        # зону, и до конца расчёта в память задачи ничего нового не попадёт.
        baking = RoomType.objects.get(pk=room_type.pk)
        before = len(baking.plan.get("zones") or [])

        zone = {
            "code": "zone-нарисована",
            "controlId": PLAN_ZONE_LIGHTS["living"],
            "hit": {"x": 10, "y": 10, "w": 10, "h": 10},
            "mask": {"x": 9, "y": 9, "w": 12, "h": 12},
        }
        editor = RoomType.objects.get(pk=room_type.pk)
        plan_geometry.edit(
            editor, lambda plan: plan.update({"zones": [*(plan.get("zones") or []), zone]})
        )

        # А теперь задача дописывает СВОЁ поле, держа устаревшую копию.
        plan_geometry.edit(
            baking,
            lambda plan: plan.update(
                {
                    "asset_off_id": "00000000-0000-0000-0000-000000000000",
                    "asset_off_source": "baked",
                }
            ),
        )

        fresh = RoomType.objects.get(pk=room_type.pk)

    assert len(fresh.plan["zones"]) == before + 1, "зона пережила расчёт ночного кадра"
    assert fresh.plan["zones"][-1]["code"] == "zone-нарисована"
    assert fresh.plan["asset_off_source"] == "baked"
