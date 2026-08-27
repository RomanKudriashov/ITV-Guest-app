"""
СТОРОЖА ДОКУМЕНТАЦИИ: книга не должна врать дольше одного прогона.

Документация устаревает первой, и устаревает ТИХО — в отличие от кода, у неё
нет ни компилятора, ни падающего теста. У нас это уже случалось дважды:
контракт описывал `/cms/departments` после переименования понятия, а докстрока
модели обещала распространение справочника, которого не существовало ни в одном
виде. Оба раза документ пережил правку кода на месяцы.

ЧТО ПРОВЕРЯЕТСЯ МАШИННО — ровно фактические утверждения, у которых есть
источник правды в коде:

  • перечисление модулей, ролей, тарифов, видов групп и исходов публикации
    совпадает с перечислением в коде;
  • упомянутая команда `manage.py` существует.

Адреса экранов и переменные окружения сторожит фронт
(`frontend/scripts/check-docs.mjs`): маршрутизатор и образец окружения лежат
вне контейнера бэкенда, и читать их отсюда нечем. Разделение по доступности
файлов, а не по смыслу.

ЧТО НЕ ПРОВЕРЯЕТСЯ И НЕ БУДЕТ — смысл. Сторож не отличит верное объяснение от
бессмысленного, а регулярка по прозе даёт сторожа, который краснеет на
переформулировке. Такого выключают первым, и вместе с ним выключают эти пять.

КАК ПОМЕТИТЬ ПЕРЕЧИСЛЕНИЕ. Списки, которые обязаны совпадать с кодом, книга
обрамляет комментарием:

    <!-- check:modules -->
    | `room_control` | Управление номером |
    ...
    <!-- /check -->

Внутри блока сторож собирает всё, что в обратных кавычках, и требует ТОЧНОГО
совпадения множеств. Не «упомянутое существует», а «перечислено ровно то, что
есть»: забытый в книге модуль — такая же ложь, как выдуманный.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"

#: Блок перечисления: `<!-- check:НАЗВАНИЕ -->` … `<!-- /check -->`.
_BLOCK = re.compile(r"<!--\s*check:([a-z-]+)\s*-->(.*?)<!--\s*/check\s*-->", re.S)
#: Что-нибудь в обратных кавычках.
_TICKED = re.compile(r"`([^`]+)`")


def _docs() -> list[Path]:
    return sorted(path for path in DOCS.rglob("*.md") if "node_modules" not in str(path))


def _blocks(name: str) -> list[tuple[Path, set[str]]]:
    """Все блоки заданного вида по всем документам."""
    found: list[tuple[Path, set[str]]] = []
    for path in _docs():
        for kind, body in _BLOCK.findall(path.read_text(encoding="utf-8")):
            if kind == name:
                found.append((path, set(_TICKED.findall(body))))
    return found


def _assert_block_matches(name: str, expected: set[str]) -> None:
    blocks = _blocks(name)
    if not blocks:
        pytest.skip(f"перечисление «{name}» в книге пока не появилось")

    for path, listed in blocks:
        extra = listed - expected
        missing = expected - listed
        assert not extra, (
            f"{path.relative_to(ROOT)}: книга перечисляет то, чего в коде нет — "
            f"{sorted(extra)}"
        )
        assert not missing, (
            f"{path.relative_to(ROOT)}: в коде это есть, а в книге не перечислено — "
            f"{sorted(missing)}. Забытое в книге врёт так же, как выдуманное."
        )


# --- 1. Модули, роли, тарифы, области ---------------------------------------


def test_the_module_list_matches_the_code():
    from apps.hotels.models import HotelModule

    _assert_block_matches("modules", {code.value for code in HotelModule.Code})


def test_the_platform_roles_match_the_code():
    """
    РОЛЬ — ЭТО ПРАВО, А НЕ ОБЛАСТЬ.

    «Администратор группы» в перечислении ролей обязан краснеть: это поддержка
    с областью, а не четвёртая роль. Ошибка ровно того рода, ради которой
    сторож и нужен: в разговоре так говорят, и в книгу это попадёт само.
    """
    from apps.accounts.models import User

    _assert_block_matches("platform-roles", {role.value for role in User.PlatformRole})


def test_the_tariffs_match_the_code():
    from apps.hotels.services import tariffs

    _assert_block_matches("tariffs", set(tariffs.codes()))


def test_the_group_kinds_match_the_code():
    from apps.hotels.models import HotelGroup

    _assert_block_matches("group-kinds", {kind.value for kind in HotelGroup.Kind})


def test_the_publication_outcomes_match_the_code():
    from apps.hotels.models import PublicationResult

    _assert_block_matches(
        "publication-outcomes", {outcome.value for outcome in PublicationResult.Outcome}
    )


# --- 2. Команды --------------------------------------


_COMMAND = re.compile(r"manage\.py\s+([a-z_][a-z0-9_]*)")


def test_every_management_command_in_the_docs_exists():
    """
    КОМАНДА ИЗ КНИГИ СУЩЕСТВУЕТ.

    Инструкция по установке — это список команд; команда, переименованная в
    коде, превращает её в инструкцию, которую нельзя выполнить, и узнают об
    этом на боевом сервере.
    """
    from django.core.management import get_commands

    known = set(get_commands())
    wrong: list[str] = []
    for path in _docs():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in _COMMAND.finditer(line):
                name = match.group(1)
                if name not in known:
                    wrong.append(f"  {path.relative_to(ROOT)}:{number} — manage.py {name}")

    assert not wrong, "Книга зовёт несуществующую команду:\n" + "\n".join(wrong)
