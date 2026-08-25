"""
Конструктор интерфейса, публикация и проверка на живом номере.

Проверяется то, что нельзя починить после выкатки: валидация привязок (иначе в
оборудование уедет значение вне диапазона), правило «непривязанный элемент не
публикуется» (иначе гость получит мёртвую кнопку) и самодостаточность снимка
версии (иначе откат перестанет быть откатом).
"""

from __future__ import annotations

from apps.core.models import AuditLog

# Кто нажал — в этих проверках неважно: они про механику публикации,
# а не про владельца действия. Называем систему, а не выдумываем человека.
SYSTEM_ACTOR = AuditLog.ActorType.SYSTEM

import time

import pytest

from apps.core.context import tenant_context
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.grms.services import builder, catalog, publishing, roomcheck
from apps.grms.models import PublishedConfig, RoomType, Variable
from apps.hotels.models import Room

pytestmark = pytest.mark.django_db

TYPE = "std"


@pytest.fixture
def furnished(crystal):
    """Тип с переменными под свет, фанкойл и сцену — как после импорта."""
    with tenant_context(crystal):
        room_type = RoomType.objects.create(
            code=TYPE,
            title={"ru": "Стандарт"},
            device_name_template="Modbus TCP Server (Slave mode) {room}",
        )
        make = lambda **kw: Variable.objects.create(room_type=room_type, **kw)  # noqa: E731
        make(key="dnd", command="C_DND", feedback="F_DND", value_kind="binary",
             min_value=0, max_value=1, raw_range="0/1")
        make(key="light_1", command="C_Light 1", feedback="F_Light 1", value_kind="binary",
             min_value=0, max_value=1, raw_range="0/1")
        make(key="light_2", command="C_Light 2", feedback="F_Light 2", value_kind="binary",
             min_value=0, max_value=1, raw_range="0/1")
        make(key="fcu_main", command="C_FCU_MainSw 1", feedback="F_FCU_MainSw 1",
             value_kind="binary", min_value=0, max_value=1, raw_range="0-1")
        make(key="fcu_speed", command="C_FCU_Speed 1", feedback="F_FCU_Speed 1",
             value_kind="enum", min_value=0, max_value=3, raw_range="0-3")
        make(key="fcu_setpoint", command="C_FCU_Setpoint 1", feedback="F_FCU_Setpoint 1",
             value_kind="range", min_value=16, max_value=32, raw_range="16-32")
        make(key="fcu_temp", command="", feedback="F_FCU_Temperature 1",
             value_kind="range", min_value=16, max_value=32, raw_range="16-32")
        make(key="scene_1", command="C_Scene_1", feedback="", value_kind="binary",
             min_value=0, max_value=1, raw_range="0/1")
    return crystal


def _light(hotel, slug="light.main", key="light_1"):
    builder.add_element(hotel, room_type_code=TYPE, kind="light_group", slug=slug)
    builder.bind(hotel, room_type_code=TYPE, element_slug=slug, capability="toggle",
                 variable_key=key)


# --- Валидация привязок -----------------------------------------------------


def test_binding_requires_matching_value_kind(furnished):
    """
    Несовместимость проявляется не сразу и неприятно: гость двигает кольцо
    термостата, а в оборудование уходит значение вне допустимого диапазона.
    """
    builder.add_element(furnished, room_type_code=TYPE, kind="air_conditioner", slug="ac.1")
    with pytest.raises(ValidationError) as excinfo:
        builder.bind(furnished, room_type_code=TYPE, element_slug="ac.1",
                     capability="setpoint", variable_key="light_1")
    assert "range" in str(excinfo.value)


def test_current_temp_refuses_a_variable_that_has_a_command(furnished):
    """
    Текущая температура объявлена «только чтение». Привязав её к переменной С
    командой, мы разрешили бы запись — и обещание read-only перестало бы быть
    правдой.
    """
    builder.add_element(furnished, room_type_code=TYPE, kind="air_conditioner", slug="ac.1")
    with pytest.raises(ValidationError) as excinfo:
        builder.bind(furnished, room_type_code=TYPE, element_slug="ac.1",
                     capability="current_temp", variable_key="fcu_setpoint")
    assert "только чтение" in str(excinfo.value)


def test_toggle_requires_feedback_but_trigger_does_not(furnished):
    """Сцена — единственный элемент, которому подтверждать нечем, и это норма."""
    builder.add_element(furnished, room_type_code=TYPE, kind="light_group", slug="light.x")
    with pytest.raises(ValidationError):
        builder.bind(furnished, room_type_code=TYPE, element_slug="light.x",
                     capability="toggle", variable_key="scene_1")

    builder.add_element(furnished, room_type_code=TYPE, kind="scene", slug="scene.night")
    builder.bind(furnished, room_type_code=TYPE, element_slug="scene.night",
                 capability="trigger", variable_key="scene_1")


def test_element_rejects_capability_it_does_not_have(furnished):
    builder.add_element(furnished, room_type_code=TYPE, kind="dnd", slug="dnd")
    with pytest.raises(ValidationError):
        builder.bind(furnished, room_type_code=TYPE, element_slug="dnd",
                     capability="setpoint", variable_key="fcu_setpoint")


def test_unknown_element_kind_is_refused(furnished):
    with pytest.raises(ValidationError):
        builder.add_element(furnished, room_type_code=TYPE, kind="teleporter", slug="x")


def test_one_variable_cannot_serve_two_elements(furnished):
    """Два элемента на одном канале разъехались бы в состоянии."""
    _light(furnished, "light.main", "light_1")
    builder.add_element(furnished, room_type_code=TYPE, kind="light_group", slug="light.bed")
    with pytest.raises(Exception):
        builder.bind(furnished, room_type_code=TYPE, element_slug="light.bed",
                     capability="toggle", variable_key="light_1")


# --- Много однотипных элементов ---------------------------------------------


def test_many_elements_of_the_same_kind(furnished):
    """Два фанкойла, шесть групп света, три шторы — обычное дело (ТЗ §11)."""
    _light(furnished, "light.main", "light_1")
    _light(furnished, "light.bed", "light_2")

    status = builder.type_status(furnished, TYPE)
    assert sorted(status["publishable"]) == ["light.bed", "light.main"]


# --- Зоны -------------------------------------------------------------------


def test_elements_are_grouped_into_zones(furnished):
    builder.add_zone(furnished, room_type_code=TYPE, code="bedroom",
                     title={"ru": "Спальня"}, sort_order=1)
    builder.add_element(furnished, room_type_code=TYPE, kind="light_group",
                        slug="light.main", zone_code="bedroom")
    builder.bind(furnished, room_type_code=TYPE, element_slug="light.main",
                 capability="toggle", variable_key="light_1")

    snapshot = publishing.build_snapshot(furnished, TYPE)
    assert [z["code"] for z in snapshot["zones"]] == ["bedroom"]


def test_unknown_zone_is_refused(furnished):
    with pytest.raises(NotFoundError):
        builder.add_element(furnished, room_type_code=TYPE, kind="dnd",
                            slug="dnd", zone_code="nowhere")


# --- Имя устройства ---------------------------------------------------------


def test_device_name_comes_from_the_template(furnished):
    with tenant_context(furnished):
        room = Room.objects.create(number="777")
        from apps.grms.models import RoomTypeRoom

        RoomTypeRoom.objects.create(room=room, room_type=RoomType.objects.get(code=TYPE))

    assert builder.device_for_room(furnished, "777") == "Modbus TCP Server (Slave mode) 777"


def test_per_room_override_beats_the_template(furnished):
    """
    Реальные объекты не идеально регулярны: одна комната после переделки может
    называться иначе, и менять из-за неё шаблон всего типа нельзя (ТЗ §10).
    """
    with tenant_context(furnished):
        room = Room.objects.create(number="778")
        from apps.grms.models import RoomTypeRoom

        RoomTypeRoom.objects.create(room=room, room_type=RoomType.objects.get(code=TYPE))

    builder.set_device_override(furnished, room_number="778", device_name="SHUN_1_2")
    assert builder.device_for_room(furnished, "778") == "SHUN_1_2"


# --- Публикация -------------------------------------------------------------


def test_unbound_element_stays_hidden_and_is_not_published(furnished):
    """
    Кнопка, за которой нет оборудования, хуже отсутствующей: гость её жмёт,
    ничего не происходит, и он идёт на ресепшен.
    """
    _light(furnished, "light.main", "light_1")
    # Мастер-выключатель добавлен, но переменной под него на объекте нет.
    builder.add_element(furnished, room_type_code=TYPE, kind="master_switch", slug="master")

    status = builder.type_status(furnished, TYPE)
    assert status["publishable"] == ["light.main"]
    assert [h["slug"] for h in status["hidden"]] == ["master"]

    config = publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    controls = [c["controlId"] for z in config.payload["zones"] for c in z["controls"]]
    assert controls == ["light.main"]


def test_publishing_nothing_is_refused(furnished):
    builder.add_element(furnished, room_type_code=TYPE, kind="master_switch", slug="master")
    with pytest.raises(ValidationError):
        publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)


def test_publish_increments_versions_and_keeps_one_current(furnished):
    _light(furnished, "light.main", "light_1")
    first = publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    _light(furnished, "light.bed", "light_2")
    second = publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)

    assert (first.version, second.version) == (1, 2)
    with tenant_context(furnished):
        current = PublishedConfig.objects.filter(room_type__code=TYPE, is_current=True)
        assert current.count() == 1 and current.first().version == 2


def test_snapshot_is_self_contained(furnished):
    """
    Удаление переменной в черновике НЕ имеет права сломать опубликованную
    конфигурацию — иначе откат к v2 означал бы «v2 плюс сегодняшние правки».
    """
    _light(furnished, "light.main", "light_1")
    config = publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)

    with tenant_context(furnished):
        Variable.objects.filter(key="light_1").delete()

    control = config.payload["zones"][0]["controls"][0]
    assert control["channels"]["toggle"]["command"] == "C_Light 1"
    assert control["range"]["toggle"] == {"min": 0, "max": 1, "kind": "binary"}


def test_rollback_creates_a_new_version_and_keeps_history(furnished):
    """История не переписывается: «почему свет перестал работать» должно иметь ответ."""
    _light(furnished, "light.main", "light_1")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    _light(furnished, "light.bed", "light_2")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)

    restored = publishing.rollback(furnished, TYPE, to_version=1, actor_type=SYSTEM_ACTOR)

    assert restored.version == 3 and restored.rolled_back_from == 1
    controls = [c["controlId"] for z in restored.payload["zones"] for c in z["controls"]]
    assert controls == ["light.main"]

    versions = [h["version"] for h in publishing.history(furnished, TYPE)]
    assert versions == [3, 2, 1], "старые версии обязаны сохраниться"


def test_rollback_to_missing_version_is_refused(furnished):
    _light(furnished, "light.main", "light_1")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    with pytest.raises(NotFoundError):
        publishing.rollback(furnished, TYPE, to_version=99, actor_type=SYSTEM_ACTOR)


def test_publish_and_rollback_are_audited(furnished):
    _light(furnished, "light.main", "light_1")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    # Нужна вторая версия: откат на текущую же законно отбивается.
    _light(furnished, "light.bed", "light_2")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    publishing.rollback(furnished, TYPE, to_version=1, actor_type=SYSTEM_ACTOR)

    with tenant_context(furnished):
        assert AuditLog.objects.filter(action="grms.publish").exists()
        assert AuditLog.objects.filter(action="grms.rollback").exists()


def test_published_config_is_isolated_between_hotels(furnished, aurora):
    _light(furnished, "light.main", "light_1")
    publishing.publish(furnished, TYPE, actor_type=SYSTEM_ACTOR)
    with tenant_context(aurora):
        assert PublishedConfig.objects.count() == 0


# --- Каталог ----------------------------------------------------------------


def test_every_catalog_kind_can_be_placed(furnished):
    """Каталог не должен содержать вид, который конструктор не умеет поставить."""
    for index, kind in enumerate(catalog.ELEMENTS):
        builder.add_element(furnished, room_type_code=TYPE, kind=kind, slug=f"e{index}")


# --- Черновик для конструктора ----------------------------------------------


def test_status_returns_the_draft_tree_for_the_editor(furnished):
    """
    Конструктору в CMS нужен не только приговор «опубликуется/скрыт», но и сам
    черновик: зоны, элементы и привязки. Без него администратор добавляет
    вслепую и узнаёт о добавленном по ошибке «такой элемент уже есть».
    """
    builder.add_zone(furnished, room_type_code=TYPE, code="bedroom",
                     title={"ru": "Спальня"}, sort_order=1)
    builder.add_element(furnished, room_type_code=TYPE, kind="light_group",
                        slug="light.main", zone_code="bedroom", title={"ru": "Свет"})
    builder.bind(furnished, room_type_code=TYPE, element_slug="light.main",
                 capability="toggle", variable_key="light_1")
    builder.add_element(furnished, room_type_code=TYPE, kind="master_switch", slug="master")

    status = builder.type_status(furnished, TYPE)

    assert [z["code"] for z in status["zones"]] == ["bedroom"]
    by_slug = {e["slug"]: e for e in status["elements"]}
    assert by_slug["light.main"]["zone"] == "bedroom"
    assert by_slug["light.main"]["title"] == {"ru": "Свет"}
    assert by_slug["light.main"]["bindings"] == [{"capability": "toggle", "variable": "light_1"}]
    assert by_slug["light.main"]["publishable"] is True
    # Непривязанный виден в том же дереве и объясняет себя сам.
    assert by_slug["master"]["publishable"] is False
    assert by_slug["master"]["problems"]
