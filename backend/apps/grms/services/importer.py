"""
Импорт технической карты переменных из Excel команды ПНР.

Что импорт делает: превращает файл в набор ТЕХНИЧЕСКИХ ПЕРЕМЕННЫХ и типов
номеров. Чего он не делает: не создаёт ни одной кнопки гостю. Excel — карта
переменных, а не описание интерфейса (ТЗ §8); интерфейс собирает администратор
в конструкторе.

Формат полуструктурированный, поэтому разбор устроен так, чтобы ПОКАЗЫВАТЬ
сомнительное, а не додумывать его. Результат — предпросмотр с предупреждениями,
который администратор подтверждает перед сохранением (ТЗ §9).

Разбор — zipfile + ElementTree, без openpyxl: ради одного файла раз в жизнь
объекта тянуть зависимость незачем.

ВАЖНО про парсинг ячеек. Первая попытка (в G0) читала XML регуляркой и
спотыкалась о самозакрывающиеся `<c r="C21" s="2"/>`: пустая ячейка «съедалась»,
и значения сдвигались на колонку. Из-за этого описание сцены выглядело как имя
feedback-канала, а колонка F со списками комнат вообще осталась незамеченной.
Отсюда правило: разбирать XML парсером XML, а колонку брать из атрибута `r`
ячейки, а не из её порядкового номера в строке.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_MAIN = NS["m"]

# Заголовок таблицы в файле ПНР написан с опечаткой — «Commans». Узнаём и её,
# и правильное написание: файл присылают люди, и требовать от них точности в
# заголовке значит гарантировать провал импорта на втором объекте.
_HEADER_COMMAND = {"commans", "command", "commands", "команда", "команды"}

_TYPE_HEADER = re.compile(r"^\s*(?P<name>ТИП\s*\d+|TYPE\s*\d+)\s*\(\s*(?:Номер|Room)\s*(?P<room>[\w-]+)\s*\)", re.I)
_DEVICE_PATH = re.compile(r'["«]([^"»]+)["»]')
_ROOM_LIST = re.compile(r"^\s*(?P<name>ТИП\s*\d+|TYPE\s*\d+)\s*:\s*(?P<rooms>.+)$", re.I | re.S)

# Диапазоны, как их пишет ПНР: «0/1», «0-1», «0-3», «16-32».
_RANGE = re.compile(r"^\s*(-?\d+)\s*[/\-–]\s*(-?\d+)\s*$")


class ImportError_(ValueError):
    """Файл не похож на карту переменных настолько, что разбирать нечего."""


# --- Предупреждения ---------------------------------------------------------

W_TYPE_UNCLEAR = "type_unclear"
W_NO_FEEDBACK = "command_without_feedback"
W_RANGE_UNPARSED = "range_unparsed"
W_VARIABLE_REUSED = "variable_reused"
W_ROOM_WITHOUT_TYPE = "room_without_type"
W_ROOM_IN_TWO_TYPES = "room_in_two_types"
W_UNEXPECTED_STRUCTURE = "unexpected_structure"
W_FEEDBACK_WITHOUT_COMMAND = "feedback_without_command"
W_NO_ROOMS = "type_without_rooms"


@dataclass
class Warning_:
    code: str
    message: str
    where: str = ""


@dataclass
class ParsedVariable:
    key: str
    command: str = ""
    feedback: str = ""
    value_kind: str = "binary"
    min_value: int = 0
    max_value: int = 1
    raw_range: str = ""
    description: str = ""


@dataclass
class ParsedType:
    name: str
    reference_room: str = ""
    device_name_template: str = ""
    rooms: list[str] = field(default_factory=list)
    variables: list[ParsedVariable] = field(default_factory=list)


@dataclass
class ImportPreview:
    types: list[ParsedType] = field(default_factory=list)
    warnings: list[Warning_] = field(default_factory=list)

    @property
    def room_count(self) -> int:
        return len({room for parsed in self.types for room in parsed.rooms})

    @classmethod
    def from_dict(cls, raw: dict) -> "ImportPreview":
        """
        Собрать предпросмотр обратно из JSON.

        Нужно потому, что администратор ПОДТВЕРЖДАЕТ результат и может его
        поправить (ТЗ §9): формат полуструктурированный, и последнее слово за
        человеком. Держать разобранное на сервере между двумя запросами было бы
        лишним состоянием — клиент возвращает то, что видел и правил.
        """
        preview = cls()
        for parsed in raw.get("types") or []:
            preview.types.append(
                ParsedType(
                    name=parsed.get("name", ""),
                    reference_room=str(parsed.get("reference_room") or ""),
                    device_name_template=parsed.get("device_name_template", ""),
                    rooms=[str(r) for r in (parsed.get("rooms") or [])],
                    variables=[
                        ParsedVariable(
                            key=v.get("key", ""),
                            command=v.get("command", ""),
                            feedback=v.get("feedback", ""),
                            value_kind=v.get("value_kind", "binary"),
                            min_value=int(v.get("min_value", 0)),
                            max_value=int(v.get("max_value", 1)),
                            raw_range=v.get("raw_range", ""),
                            description=v.get("description", ""),
                        )
                        for v in (parsed.get("variables") or [])
                    ],
                )
            )
        return preview

    def as_dict(self) -> dict:
        return {
            "types": [
                {
                    "name": parsed.name,
                    "reference_room": parsed.reference_room,
                    "device_name_template": parsed.device_name_template,
                    "rooms": parsed.rooms,
                    "variables": [vars(v) for v in parsed.variables],
                }
                for parsed in self.types
            ],
            "warnings": [vars(w) for w in self.warnings],
        }


# --- Чтение книги -----------------------------------------------------------


def _column(ref: str) -> str:
    return "".join(ch for ch in ref if ch.isalpha())


def _read_sheet(data: bytes) -> dict[int, dict[str, str]]:
    """
    Лист как {номер строки: {колонка: значение}}. Пустые ячейки опускаются.

    Всё, что не открылось как xlsx, превращается в ImportError_ здесь: наверх
    не должно всплывать ни BadZipFile, ни ParseError. Администратор, загрузивший
    не тот файл, обязан увидеть «это не похоже на книгу Excel», а не 500.
    """
    try:
        return _read_sheet_unsafe(data)
    except ImportError_:
        raise
    except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, IndexError) as exc:
        raise ImportError_(f"файл не читается как книга Excel: {exc}") from exc


def _read_sheet_unsafe(data: bytes) -> dict[int, dict[str, str]]:
    with zipfile.ZipFile(data if hasattr(data, "read") else _as_file(data)) as book:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in item.iter(f"{{{_MAIN}}}t")))

        names = [n for n in book.namelist() if n.startswith("xl/worksheets/sheet")]
        if not names:
            raise ImportError_("в книге нет ни одного листа")
        sheet = ET.fromstring(book.read(sorted(names)[0]))

    rows: dict[int, dict[str, str]] = {}
    for row in sheet.iter(f"{{{_MAIN}}}row"):
        number = int(row.get("r"))
        cells: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            kind = cell.get("t")
            if kind == "inlineStr":
                # Текст прямо в ячейке, без таблицы общих строк. Так пишут
                # многие генераторы, и файл со следующего объекта вполне может
                # прийти в этом виде.
                text = "".join(t.text or "" for t in cell.iter(f"{{{_MAIN}}}t"))
                if text:
                    cells[_column(cell.get("r"))] = text
                continue

            value = cell.find("m:v", NS)
            if value is None or value.text is None:
                continue
            raw = value.text
            # Колонку берём из атрибута r, а не из позиции: пустые ячейки в
            # файле просто отсутствуют, и позиционный разбор сдвинул бы данные.
            cells[_column(cell.get("r"))] = shared[int(raw)] if kind == "s" else raw
        if cells:
            rows[number] = cells
    return rows


def _as_file(data):
    import io

    return io.BytesIO(data)


# --- Разбор значений --------------------------------------------------------


def _parse_range(raw: str) -> tuple[str, int, int, bool]:
    """
    «0/1» → binary, «0-3» → enum, «16-32» → range.

    Возвращает (вид, min, max, распозналось ли). Нераспознанное НЕ
    придумывается: администратор увидит предупреждение и поправит руками.
    """
    text = (raw or "").strip()
    match = _RANGE.match(text)
    if not match:
        return "binary", 0, 1, False
    low, high = int(match.group(1)), int(match.group(2))
    if low > high:
        low, high = high, low
    if (low, high) == (0, 1):
        return "binary", 0, 1, True
    # Небольшой целочисленный набор — это перечисление (скорость 0–3), а
    # широкий — величина (уставка 16–32). Порог по смыслу, а не по вкусу:
    # у перечисления каждое значение имеет ИМЯ в интерфейсе.
    if high - low <= 5:
        return "enum", low, high, True
    return "range", low, high, True


def _key_for(command: str, feedback: str) -> str:
    """Ключ переменной: из имени канала, без префикса C_/F_."""
    source = command or feedback
    body = source[2:] if source[:2] in ("C_", "F_") else source
    return re.sub(r"[^a-z0-9]+", "_", body.strip().lower()).strip("_")


# --- Главный разбор ---------------------------------------------------------


def parse(data: bytes) -> ImportPreview:
    rows = _read_sheet(data)
    if not rows:
        raise ImportError_("лист пуст")

    preview = ImportPreview()
    room_lists: dict[str, list[str]] = {}
    current: ParsedType | None = None
    seen_headers = 0

    for number in sorted(rows):
        cells = rows[number]
        first = (cells.get("A") or "").strip()

        # Списки комнат лежат в отдельной колонке той же строки, где путь к
        # устройству. Ищем их в ЛЮБОЙ колонке правее D: в присланном файле это
        # F, но полагаться на букву нельзя.
        for column, value in cells.items():
            if column <= "D":
                continue
            match = _ROOM_LIST.match(str(value))
            if match:
                name = re.sub(r"\s+", "", match.group("name")).upper()
                rooms = [r.strip() for r in re.split(r"[,\n;]+", match.group("rooms")) if r.strip()]
                room_lists[name] = rooms

        header = _TYPE_HEADER.match(first)
        if header:
            current = ParsedType(
                name=re.sub(r"\s+", "", header.group("name")).upper(),
                reference_room=header.group("room"),
            )
            preview.types.append(current)
            continue

        if current is None:
            continue

        if first.lower().startswith(("путь к тегу", "device path", "путь")):
            path = _DEVICE_PATH.search(first)
            if path:
                device = path.group(1).strip()
                # Шаблон выводим ИЗ ЭТАЛОННОЙ комнаты: номер в имени устройства
                # заменяем плейсхолдером. Так шаблон получается из данных, а не
                # из догадки о правилах именования на объекте.
                if current.reference_room and current.reference_room in device:
                    current.device_name_template = device.replace(
                        current.reference_room, "{room}"
                    )
                else:
                    current.device_name_template = device
                    preview.warnings.append(
                        Warning_(
                            W_TYPE_UNCLEAR,
                            f"{current.name}: в имени устройства «{device}» нет номера эталонной "
                            f"комнаты «{current.reference_room}» — шаблон подставить не удалось",
                            where=f"строка {number}",
                        )
                    )
            continue

        if first.lower() in _HEADER_COMMAND:
            seen_headers += 1
            continue

        # Строка переменной: команда и/или feedback.
        command = first if first.startswith("C_") else ""
        feedback = (cells.get("C") or "").strip()
        if not command and not feedback:
            continue
        if not command and not first.startswith("F_") and feedback:
            # Строка без команды, но с feedback — законный случай (текущая
            # температура). Первая колонка при этом обычно пуста.
            pass
        if first.startswith("F_") and not feedback:
            feedback = first

        raw_range = (cells.get("B") or "").strip()
        kind, low, high, parsed_ok = _parse_range(raw_range)

        variable = ParsedVariable(
            key=_key_for(command, feedback),
            command=command,
            feedback=feedback,
            value_kind=kind,
            min_value=low,
            max_value=high,
            raw_range=raw_range,
            description=(cells.get("D") or "").strip(),
        )
        current.variables.append(variable)

        if raw_range and not parsed_ok:
            preview.warnings.append(
                Warning_(
                    W_RANGE_UNPARSED,
                    f"{current.name}/{command or feedback}: диапазон «{raw_range}» не распознан, "
                    "принят 0/1 — проверьте вручную",
                    where=f"строка {number}",
                )
            )
        if command and not feedback:
            preview.warnings.append(
                Warning_(
                    W_NO_FEEDBACK,
                    f"{current.name}/{command}: команда без обратной связи — "
                    "подтвердить выполнение будет нечем (норма для сцен)",
                    where=f"строка {number}",
                )
            )
        if feedback and not command:
            preview.warnings.append(
                Warning_(
                    W_FEEDBACK_WITHOUT_COMMAND,
                    f"{current.name}/{feedback}: обратная связь без команды — "
                    "параметр только для чтения (норма для текущей температуры)",
                    where=f"строка {number}",
                )
            )

    _attach_rooms(preview, room_lists)
    _check_duplicates(preview)

    if not preview.types:
        raise ImportError_(
            "не найдено ни одного типа номера: ожидался заголовок вида «ТИП1 (Номер 701)»"
        )
    if seen_headers == 0:
        preview.warnings.append(
            Warning_(
                W_UNEXPECTED_STRUCTURE,
                "не найдена строка заголовков таблицы (ожидалось «Commans / Value / Feedback / "
                "Description») — колонки разобраны по позиции, проверьте результат особенно внимательно",
            )
        )
    return preview


def _attach_rooms(preview: ImportPreview, room_lists: dict[str, list[str]]) -> None:
    for parsed in preview.types:
        parsed.rooms = room_lists.get(parsed.name, [])
        if not parsed.rooms:
            preview.warnings.append(
                Warning_(
                    W_NO_ROOMS,
                    f"{parsed.name}: в файле нет списка комнат — привязать номера к типу "
                    "придётся вручную",
                )
            )
        elif parsed.reference_room and parsed.reference_room not in parsed.rooms:
            preview.warnings.append(
                Warning_(
                    W_TYPE_UNCLEAR,
                    f"{parsed.name}: эталонная комната {parsed.reference_room} отсутствует "
                    "в списке комнат этого типа",
                )
            )

    unknown = set(room_lists) - {parsed.name for parsed in preview.types}
    for name in sorted(unknown):
        preview.warnings.append(
            Warning_(
                W_ROOM_WITHOUT_TYPE,
                f"список комнат «{name}» не относится ни к одному распознанному типу: "
                f"{len(room_lists[name])} комнат останутся без типа",
            )
        )


def _check_duplicates(preview: ImportPreview) -> None:
    """Комната в двух типах и переменная, использованная дважды."""
    owners: dict[str, list[str]] = {}
    for parsed in preview.types:
        for room in parsed.rooms:
            owners.setdefault(room, []).append(parsed.name)
    for room, types in sorted(owners.items()):
        if len(types) > 1:
            preview.warnings.append(
                Warning_(
                    W_ROOM_IN_TWO_TYPES,
                    f"комната {room} отнесена сразу к нескольким типам ({', '.join(types)}) — "
                    "оборудование у них разное, выберите один",
                )
            )

    for parsed in preview.types:
        seen: dict[str, int] = {}
        for variable in parsed.variables:
            for channel in (variable.command, variable.feedback):
                if not channel:
                    continue
                seen[channel] = seen.get(channel, 0) + 1
        for channel, count in seen.items():
            if count > 1:
                preview.warnings.append(
                    Warning_(
                        W_VARIABLE_REUSED,
                        f"{parsed.name}: канал {channel} встречается {count} раза — "
                        "переменная задана дважды",
                    )
                )
