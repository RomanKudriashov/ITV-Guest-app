"""
Импорт технической карты из Excel.

Разбирается НАСТОЯЩИЙ файл ПНР (docs/grms/240701_Переменные для ПНР.xlsx), а не
синтетический: формат полуструктурированный, и придуманный файл проверял бы
парсер против собственных ожиданий, а не против того, что реально присылают.

Отдельно проверяется, что импорт не создаёт гостевой интерфейс: Excel — карта
переменных, а не описание экрана (ТЗ §8).
"""

from __future__ import annotations


import pytest

from tests.helpers import FIXTURES

from apps.core.context import tenant_context
from apps.grms.services import builder, importer
from apps.grms.models import ControlElement, RoomType, RoomTypeRoom, Variable
from apps.hotels.models import Room

# Копия присланного файла ПНР (docs/grms/240701_Переменные для ПНР.xlsx).
# Лежит рядом с тестами, а не читается из docs/: набор обязан гоняться в
# контейнере, куда docs/ не смонтирован, и не зависеть от раскладки репозитория.
PNR = FIXTURES / "pnr-variables.xlsx"


@pytest.fixture(scope="module")
def preview():
    return importer.parse(PNR.read_bytes())


# --- Разбор -----------------------------------------------------------------


def test_three_types_with_reference_rooms(preview):
    assert [t.name for t in preview.types] == ["ТИП1", "ТИП2", "ТИП3"]
    assert [t.reference_room for t in preview.types] == ["701", "708", "706"]


def test_device_template_is_derived_from_data_not_guessed(preview):
    """
    Шаблон получается заменой номера ЭТАЛОННОЙ комнаты в реальном имени
    устройства. Догадка о правилах именования на объекте здесь недопустима.
    """
    for parsed in preview.types:
        assert parsed.device_name_template == "Modbus TCP Server (Slave mode) {room}"


def test_room_lists_are_read_from_their_own_column(preview):
    """
    Списки комнат лежат в колонке F, а не в A–D. В первом разборе (G0) они были
    пропущены целиком, потому что XML читался регуляркой.
    """
    counts = {t.name: len(t.rooms) for t in preview.types}
    assert counts == {"ТИП1": 97, "ТИП2": 6, "ТИП3": 13}
    assert "701" in preview.types[0].rooms
    assert preview.types[1].rooms == ["212", "312", "412", "512", "612", "708"]


def test_misspelled_header_is_recognised(preview):
    """Заголовок в файле — «Commans» с опечаткой. Требовать точности нельзя."""
    codes = {w.code for w in preview.warnings}
    assert importer.W_UNEXPECTED_STRUCTURE not in codes


def test_ranges_are_classified_by_meaning(preview):
    by_command = {
        v.command: v for parsed in preview.types for v in parsed.variables if v.command
    }
    assert by_command["C_DND"].value_kind == "binary"
    # 0 — это АВТО, и у каждого значения есть имя в интерфейсе → перечисление.
    assert by_command["C_FCU_Speed 1"].value_kind == "enum"
    assert (by_command["C_FCU_Speed 1"].min_value, by_command["C_FCU_Speed 1"].max_value) == (0, 3)
    # Уставка — величина, а не набор именованных значений.
    assert by_command["C_FCU_Setpoint 1"].value_kind == "range"
    assert (by_command["C_FCU_Setpoint 1"].min_value, by_command["C_FCU_Setpoint 1"].max_value) == (16, 32)


def test_scenes_have_no_feedback_and_that_is_normal(preview):
    """
    В файле у сцен колонка Feedback ПУСТАЯ, а описание говорит «momentary
    button». Совпадает с боевым сервером: тегов F_Scene_* там нет.
    """
    scenes = [v for v in preview.types[0].variables if v.key.startswith("scene")]
    assert scenes and all(not v.feedback for v in scenes)
    assert all("momentary" in v.description for v in scenes)


# --- Предупреждения ---------------------------------------------------------


def test_command_without_feedback_is_reported(preview):
    warned = [w for w in preview.warnings if w.code == importer.W_NO_FEEDBACK]
    assert warned, "команда без обратной связи обязана попасть в предупреждения"
    assert any("Scene" in w.message for w in warned)


def test_room_assigned_to_two_types_is_reported(preview):
    """
    Реальный конфликт в присланном файле: комната 506 перечислена и в ТИП1,
    и в ТИП3. Оборудование у типов разное — разрешать это гаданием нельзя.
    """
    conflicts = [w for w in preview.warnings if w.code == importer.W_ROOM_IN_TWO_TYPES]
    assert len(conflicts) == 1
    assert "506" in conflicts[0].message
    assert "ТИП1" in conflicts[0].message and "ТИП3" in conflicts[0].message


def test_unparsed_range_warns_and_does_not_invent_a_value():
    book = _synthetic(range_cell="как получится")
    result = importer.parse(book)
    warned = [w for w in result.warnings if w.code == importer.W_RANGE_UNPARSED]
    assert warned and "как получится" in warned[0].message


def test_reused_variable_is_reported():
    book = _synthetic(duplicate=True)
    result = importer.parse(book)
    assert any(w.code == importer.W_VARIABLE_REUSED for w in result.warnings)


def test_type_without_room_list_is_reported():
    book = _synthetic(rooms=None)
    result = importer.parse(book)
    assert any(w.code == importer.W_NO_ROOMS for w in result.warnings)


def test_file_without_types_is_refused_not_guessed():
    """Стоп-guard: структура не та — показать, а не додумать."""
    book = _synthetic(no_type_header=True)
    with pytest.raises(importer.ImportError_):
        importer.parse(book)


# --- Сохранение -------------------------------------------------------------


@pytest.mark.django_db
def test_import_creates_variables_and_not_a_single_control(crystal, preview):
    """
    Импорт не создаёт гостевой интерфейс. Ни одной кнопки — это ТЗ §8, а не
    недоделка: интерфейс собирает администратор в конструкторе.
    """
    builder.save_import(crystal, preview)

    with tenant_context(crystal):
        assert RoomType.objects.count() == 3
        assert Variable.objects.filter(room_type__code="тип1").exists() or Variable.objects.exists()
        assert ControlElement.objects.count() == 0, "импорт не имеет права рисовать интерфейс"


@pytest.mark.django_db
def test_import_binds_only_rooms_that_exist_in_the_system(crystal, preview):
    """
    Файл перечисляет весь номерной фонд объекта, а в системе заведена часть.
    Ненайденные возвращаются списком, а не создаются молча — иначе опечатка
    в файле родила бы номер-призрак.
    """
    report = builder.save_import(crystal, preview)

    with tenant_context(crystal):
        existing = set(Room.objects.values_list("number", flat=True))
        linked = set(
            RoomTypeRoom.objects.select_related("room").values_list("room__number", flat=True)
        )

    assert linked <= existing
    assert report["rooms_not_in_system"], "часть комнат файла в системе не заведена"
    assert not (set(report["rooms_not_in_system"]) & existing)


@pytest.mark.django_db
def test_import_is_isolated_between_hotels(crystal, aurora, preview):
    builder.save_import(crystal, preview)
    with tenant_context(aurora):
        assert RoomType.objects.count() == 0
        assert Variable.objects.count() == 0


# --- Синтетические книги для краевых случаев --------------------------------


def _synthetic(*, range_cell: str = "0/1", duplicate: bool = False,
               rooms: str | None = "ТИП1: 101, 102", no_type_header: bool = False) -> bytes:
    """
    Минимальная книга xlsx руками.

    Настоящий файл ПНР один, и краевые случаи (нераспознанный диапазон, дубль
    переменной) в нём не встречаются — а проверить их нужно.
    """
    import io
    import zipfile

    rows = []
    if not no_type_header:
        rows.append((1, {"A": "ТИП1 (Номер 101)"}))
        rows.append((2, {"A": 'Путь к тегу сервера: "Modbus TCP Server (Slave mode) 101"',
                         **({"F": rooms} if rooms else {})}))
    rows.append((3, {"A": "Commans", "B": "Value", "C": "Feedback", "D": "Description"}))
    rows.append((4, {"A": "C_Light 1", "B": range_cell, "C": "F_Light 1", "D": "свет"}))
    if duplicate:
        rows.append((5, {"A": "C_Light 1", "B": "0/1", "C": "F_Light 1", "D": "он же"}))

    def cell(ref, value):
        return f'<c r="{ref}" t="inlineStr"><is><t>{value}</t></is></c>'

    body = ""
    for number, cells in rows:
        inner = "".join(cell(f"{col}{number}", str(val)) for col, val in sorted(cells.items()))
        body += f'<row r="{number}">{inner}</row>'

    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{body}</sheetData></worksheet>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as book:
        book.writestr("xl/worksheets/sheet1.xml", sheet)
    return buffer.getvalue()


def test_cyrillic_type_names_do_not_collapse_into_one_code():
    """
    Код типа читается человеком и остаётся разным у разных типов.

    Первая версия слага выбрасывала всё, кроме латиницы и цифр: «ТИП1»
    превращался в «1», а имя без цифры — в общее «type», и два таких типа
    получили бы ОДИН код, сложившись в один вместе со своими переменными.
    Найдено E2E-прогоном раздела CMS на настоящем присланном файле.
    """
    from apps.grms.services.builder import _slug

    codes = [_slug(name) for name in ("ТИП1", "ТИП2", "ТИП3")]
    assert codes == ["tip1", "tip2", "tip3"]
    assert len(set(codes)) == 3
