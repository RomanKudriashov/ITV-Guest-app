"""
Сверка импорта с ЖИВЫМ сервером и проверка элемента на комнате.

Смысл сверки в одной фразе: **Excel не источник истины**. Прозвон G0 нашёл у
ТИП1 двенадцать групп света на сервере против десяти в файле. Настроив
интерфейс по файлу, объект получил бы две группы, которыми гость управлять не
может, и узнал бы об этом из жалобы.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.grms.services import builder, publishing, reconcile, roomcheck
from apps.grms.models import RoomType, Variable

from .grms_harness import wire

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

TYPE = "std"
# Эмулятор seed'ит устройства теми же именами, что найдены на боевом сервере.
TEMPLATE = "Modbus TCP Server (Slave mode) {room}"


@pytest.fixture
def stand(crystal):
    context, finish = wire(crystal, latency_range=(0.15, 0.25))
    try:
        yield context
    finally:
        finish()


def _type_with(hotel, variables: list[dict], *, code: str = TYPE) -> RoomType:
    with tenant_context(hotel):
        room_type = RoomType.objects.create(
            code=code, title={"ru": code}, device_name_template=TEMPLATE
        )
        for variable in variables:
            Variable.objects.create(room_type=room_type, **variable)
        return room_type


# --- Сверка -----------------------------------------------------------------


def test_reconcile_finds_channels_missing_from_the_excel(stand):
    """
    Главный сценарий: в файле света меньше, чем на железе.

    Эмулятор seed'ит комнату 701 с двенадцатью группами — ровно как боевой
    сервер. «Импортируем» десять и ждём, что сверка покажет две лишние.
    """
    hotel = stand["hotel"]
    feedbacks = ["F_DND"] + [f"F_Light {i}" for i in range(1, 11)]

    report = reconcile.reconcile_type(
        hotel,
        type_name="ТИП1",
        device_name_template=TEMPLATE,
        reference_room="701",
        feedbacks=feedbacks,
    )

    assert report.checked, f"сверка не выполнилась: {report.reason}"
    assert report.has_discrepancies
    assert sorted(c.feedback for c in report.extra) == ["F_Light 11", "F_Light 12"]
    assert not report.missing


def test_reconcile_reports_channels_absent_on_hardware(stand):
    """Обратный случай: в файле канал есть, на железе его нет."""
    hotel = stand["hotel"]
    report = reconcile.reconcile_type(
        hotel,
        type_name="ТИП1",
        device_name_template=TEMPLATE,
        reference_room="701",
        # У комнаты 701 эмулятора одна штора — как на боевом сервере.
        feedbacks=["F_DND", "F_Curtain 1", "F_Curtain 2"],
    )
    assert [c.feedback for c in report.missing] == ["F_Curtain 2"]


def test_reconcile_reports_a_missing_device(stand):
    report = reconcile.reconcile_type(
        stand["hotel"],
        type_name="ТИПX",
        device_name_template=TEMPLATE,
        reference_room="999",
        feedbacks=["F_DND"],
    )
    assert report.reason == reconcile.STATUS_DEVICE_MISSING


def test_reconcile_does_not_block_when_connector_is_offline(crystal):
    """
    Стоп-guard из задания: коннектор офлайн — разрешить сохранение с пометкой,
    НЕ блокировать. Объект настраивают и до того, как коробку подключили.
    """
    report = reconcile.reconcile_type(
        crystal,
        type_name="ТИП1",
        device_name_template=TEMPLATE,
        reference_room="701",
        feedbacks=["F_DND"],
    )
    assert report.checked is False
    assert report.reason == reconcile.STATUS_NOT_CHECKED


def test_rooms_absent_on_the_stand_are_not_an_error(stand):
    """
    Стенд заведомо частичный: 15 устройств против 115 комнат в файле.
    Поэтому результат делится на «есть» и «не найдено», а не на «ок» и «сломано».
    """
    result = reconcile.rooms_present_on_server(
        stand["hotel"], device_name_template=TEMPLATE, rooms=["701", "706", "888"]
    )
    assert result["checked"] is True
    assert "701" in result["present"] and "706" in result["present"]
    assert result["absent"] == ["888"]


def test_scene_channel_is_seen_as_absent_because_it_has_no_feedback(stand):
    """У сцен feedback'а нет — сверка обязана показать это, а не молчать."""
    report = reconcile.reconcile_type(
        stand["hotel"],
        type_name="ТИП1",
        device_name_template=TEMPLATE,
        reference_room="701",
        feedbacks=["F_Scene_1"],
    )
    assert [c.feedback for c in report.missing] == ["F_Scene_1"]


# --- Проверка элемента на живом номере --------------------------------------


@pytest.fixture
def wired_type(stand):
    hotel = stand["hotel"]
    _type_with(
        hotel,
        [
            dict(key="light_1", command="C_Light 1", feedback="F_Light 1",
                 value_kind="binary", min_value=0, max_value=1, raw_range="0/1"),
            dict(key="scene_1", command="C_Scene_1", feedback="",
                 value_kind="binary", min_value=0, max_value=1, raw_range="0/1"),
        ],
    )
    with tenant_context(hotel):
        from apps.grms.models import RoomTypeRoom
        from apps.hotels.models import Room

        room, _ = Room.objects.get_or_create(number="701")
        RoomTypeRoom.objects.create(
            room=room, room_type=RoomType.objects.get(code=TYPE), is_reference=True
        )

    builder.add_element(hotel, room_type_code=TYPE, kind="light_group", slug="light.main")
    builder.bind(hotel, room_type_code=TYPE, element_slug="light.main",
                 capability="toggle", variable_key="light_1")
    builder.add_element(hotel, room_type_code=TYPE, kind="scene", slug="scene.night")
    builder.bind(hotel, room_type_code=TYPE, element_slug="scene.night",
                 capability="trigger", variable_key="scene_1")
    return stand


def test_check_without_a_value_only_reads(wired_type):
    """
    По умолчанию проверка НИЧЕГО не переключает: администратор должен уметь
    проверить маппинг в занятом номере, не мигая там светом.
    """
    result = roomcheck.check_element(
        wired_type["hotel"], room_type_code=TYPE, element_slug="light.main", room_number="701"
    )
    assert [step["step"] for step in result["steps"]] == ["read_before"]
    assert result["device"] == "Modbus TCP Server (Slave mode) 701"


def test_check_shows_the_full_exchange_and_confirms(wired_type):
    result = roomcheck.check_element(
        wired_type["hotel"], room_type_code=TYPE, element_slug="light.main",
        room_number="701", value=1,
    )
    assert result["outcome"] == roomcheck.OUTCOME_CONFIRMED
    steps = [step["step"] for step in result["steps"]]
    assert steps == ["read_before", "set"]
    # Сырой ответ железа показывается администратору как есть.
    assert result["steps"][0]["raw"]


def test_scene_check_reports_that_there_is_nothing_to_confirm(wired_type):
    result = roomcheck.check_element(
        wired_type["hotel"], room_type_code=TYPE, element_slug="scene.night",
        room_number="701", value=1,
    )
    assert result["outcome"] == roomcheck.OUTCOME_NO_FEEDBACK_CHANNEL
    assert "подтверждать нечем" in result["note"]


def test_dead_feedback_is_explained_not_blamed_on_the_mapping(wired_type):
    """
    Картина боевого стенда: команда принята, обратная связь не двинулась.

    Показать это как «не подтверждено» без объяснения — значит отправить
    администратора переделывать ПРАВИЛЬНЫЙ маппинг. Поэтому отдельный исход
    и текст про состояние стенда.
    """
    emulator = wired_type["emulator"]
    # Замораживаем обратную связь: SET принимается, значение не меняется —
    # ровно как на стенде без поднятого обмена с GRMS.
    emulator.set_value = lambda device, channel, value: True

    result = roomcheck.check_element(
        wired_type["hotel"], room_type_code=TYPE, element_slug="light.main",
        room_number="701", value=1,
    )
    assert result["outcome"] == roomcheck.OUTCOME_FEEDBACK_DEAD
    assert "состояние стенда" in result["note"]


def test_check_refuses_an_unbound_element(wired_type):
    from apps.core.errors import ValidationError

    builder.add_element(
        wired_type["hotel"], room_type_code=TYPE, kind="master_switch", slug="master"
    )
    with pytest.raises(ValidationError):
        roomcheck.check_element(
            wired_type["hotel"], room_type_code=TYPE, element_slug="master", room_number="701"
        )


def test_check_uses_the_per_room_device_override(wired_type):
    builder.set_device_override(
        wired_type["hotel"], room_number="701", device_name="Modbus TCP Server (Slave mode) 706"
    )
    result = roomcheck.check_element(
        wired_type["hotel"], room_type_code=TYPE, element_slug="light.main", room_number="701"
    )
    assert result["device"] == "Modbus TCP Server (Slave mode) 706"
