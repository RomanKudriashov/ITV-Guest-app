"""
Скелет GRMS: изоляция тенанта на новых таблицах и целостность каталога.

Логики модуля в G0 нет, поэтому проверяется ровно то, что в G0 есть и что
дороже всего чинить потом: строчная изоляция (ошибка здесь = управление чужим
номером) и то, что фиксированный каталог не разъехался сам с собой.

Изоляция проверяется через .all_objects — менеджер БЕЗ фильтра по тенанту.
Смысл именно в этом: TenantManager и так отфильтрует, а RLS ловит то, что мимо
него. Если строки чужого отеля видны через all_objects, значит политика не
работает, хотя обычные тесты этого не заметят.
"""

from __future__ import annotations

import pytest
from django.db import connection, transaction
from django.db.utils import ProgrammingError

from apps.core.context import tenant_context
from apps.grms import catalog
from apps.grms.models import (
    Binding,
    ControlElement,
    PublishedConfig,
    RoomType,
    RoomTypeRoom,
    Variable,
    Zone,
)
from apps.hotels.models import Room

pytestmark = pytest.mark.django_db

GRMS_TABLES = [
    "grms_room_type",
    "grms_room_type_room",
    "grms_zone",
    "grms_variable",
    "grms_control_element",
    "grms_binding",
    "grms_published_config",
]


def _make_type(hotel, *, code: str) -> RoomType:
    with tenant_context(hotel):
        return RoomType.objects.create(
            code=code,
            title={"ru": f"Тип {code}"},
            device_name_template="Modbus TCP Server (Slave mode) {room}",
        )


# --- Изоляция тенанта ------------------------------------------------------


def test_room_type_is_invisible_to_another_hotel(crystal, aurora):
    _make_type(crystal, code="standard")

    with tenant_context(aurora):
        assert RoomType.objects.count() == 0
        # Главное: даже мимо TenantManager чужая строка не видна — это RLS.
        assert RoomType.all_objects.count() == 0

    with tenant_context(crystal):
        assert RoomType.objects.count() == 1


def test_whole_config_tree_is_isolated(crystal, aurora):
    """Изоляция проверяется на КАЖДОЙ таблице, а не только на корневой."""
    room_type = _make_type(crystal, code="deluxe")

    with tenant_context(crystal):
        room = Room.objects.create(number="701")
        RoomTypeRoom.objects.create(room=room, room_type=room_type, is_reference=True)
        zone = Zone.objects.create(room_type=room_type, code="bedroom", title={"ru": "Спальня"})
        variable = Variable.objects.create(
            room_type=room_type,
            key="light_1",
            command="C_Light 1",
            feedback="F_Light 1",
            value_kind=Variable.ValueKind.BINARY,
            min_value=0,
            max_value=1,
            raw_range="0/1",
        )
        element = ControlElement.objects.create(
            room_type=room_type, zone=zone, slug="light.main", kind="light_group"
        )
        Binding.objects.create(element=element, capability="toggle", variable=variable)
        PublishedConfig.objects.create(room_type=room_type, version=1, is_current=True)

    with tenant_context(aurora):
        for model in (
            RoomType,
            RoomTypeRoom,
            Zone,
            Variable,
            ControlElement,
            Binding,
            PublishedConfig,
        ):
            assert model.all_objects.count() == 0, f"{model.__name__} протекает между отелями"


def test_no_tenant_context_means_no_rows(crystal):
    """
    Fail-closed: без контекста тенанта строк не видно вовсе.

    Не выставленная сессионная переменная → current_setting(..., true) → NULL →
    сравнение NULL → строка не видна. Забыть контекст должно означать «ничего
    не нашлось», а не «нашлось всё».
    """
    _make_type(crystal, code="suite")

    assert RoomType.all_objects.count() == 0


def test_writing_into_another_hotel_is_rejected(crystal, aurora):
    """
    WITH CHECK: под контекстом одного отеля нельзя записать строку другого.

    Без этого RLS защищала бы только чтение, и подменённый hotel_id создавал бы
    конфигурацию в чужом отеле.
    """
    with tenant_context(crystal):
        room_type = RoomType(
            hotel_id=aurora.pk, code="smuggled", title={"ru": "Чужой"}
        )
        with pytest.raises(ProgrammingError):
            with transaction.atomic():
                room_type.save()


# --- Политики на месте -----------------------------------------------------


def test_grms_tables_have_forced_rls():
    """
    FORCE, а не только ENABLE.

    Без FORCE владелец таблицы — роль, которой прогоняли миграции, — политику
    ИГНОРИРУЕТ. То есть ровно та роль, под которой ходит приложение.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = ANY(%s)
            """,
            [GRMS_TABLES],
        )
        rows = {name: (enabled, forced) for name, enabled, forced in cursor.fetchall()}

    assert set(rows) == set(GRMS_TABLES), f"Таблиц не хватает: {set(GRMS_TABLES) - set(rows)}"
    not_forced = [name for name, (_, forced) in rows.items() if not forced]
    assert not not_forced, f"Без FORCE ROW LEVEL SECURITY: {not_forced}"
    not_enabled = [name for name, (enabled, _) in rows.items() if not enabled]
    assert not not_enabled, f"Без ENABLE ROW LEVEL SECURITY: {not_enabled}"


# --- Каталог ---------------------------------------------------------------


def test_every_element_capability_exists():
    for kind in catalog.ELEMENTS.values():
        unknown = set(kind.capabilities) - set(catalog.CAPABILITIES)
        assert not unknown, f"Элемент «{kind.code}» ссылается на неизвестные capability: {unknown}"


def test_every_element_has_at_least_one_required_capability():
    for kind in catalog.ELEMENTS.values():
        assert kind.required, f"У элемента «{kind.code}» нет обязательных capability"


def test_scene_needs_no_feedback():
    """
    Подтверждено прозвоном: тегов F_Scene_* на боевом сервере нет.

    Если trigger когда-нибудь потребует feedback, сцены перестанут
    подтверждаться и гость увидит «не удалось выполнить» на каждой сцене.
    """
    assert catalog.CAPABILITIES["trigger"].requires_feedback is False
    assert catalog.ELEMENTS["scene"].required == ("trigger",)


def test_current_temp_is_readonly_and_has_no_command():
    """Текущая температура — параметр только для чтения (ТЗ §12)."""
    current_temp = catalog.CAPABILITIES["current_temp"]
    assert current_temp.readonly is True
    assert current_temp.requires_command is False


def test_element_choices_cover_catalog():
    """Choices модели и каталог — один источник правды, а не две копии."""
    assert [code for code, _ in catalog.ELEMENT_CHOICES] == list(catalog.ELEMENTS)
