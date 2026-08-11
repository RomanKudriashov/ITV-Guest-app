"""
СЕТЬ БЕЗОПАСНОСТИ ПЕРЕД ПЕРЕНОСОМ РАСКЛАДКИ.

Эти пять проверок не про поведение продукта. Они про то, что при перекладывании
файлов ничего не пропало ТИХО — а тихо здесь пропадает почти всё:

  • эндпоинт, у которого забыли подключить роутер, отвечает 404 — и это увидит
    только тот тест, который его зовёт;
  • задача Celery, переехавшая в другой модуль, меняет ИМЯ, воркер отвечает
    «Received unregistered task», а код при этом импортируется и тесты в
    eager-режиме проходят. Уже наступали на это с погодой;
  • команда `manage.py`, уехавшая из `management/commands/`, исчезает молча —
    её хватится сид или уборка стенда, то есть не разработчик;
  • модуль, который не зовёт ни один тест, живёт со сломанным импортом до
    первого обращения.

Прогон из 787 тестов проверяет ТО, ЧТО ЗОВЁТ. Эти проверки — про то, что есть
вообще. Они дешёвые и гоняются перед каждой партией переноса.
"""

from __future__ import annotations

import importlib
import json
import pkgutil
import re
from pathlib import Path

import pytest

SNAPSHOTS = Path(__file__).parent / "snapshots"


# --- 1. Карта адресов -------------------------------------------------------


def _current_routes() -> dict[str, list[str]]:
    """Адреса и методы из OpenAPI-схемы — то, что реально смонтировано."""
    from api import api

    schema = api.get_openapi_schema()
    methods = {"get", "post", "put", "patch", "delete"}
    return {
        path: sorted(method.upper() for method in operations if method in methods)
        for path, operations in schema["paths"].items()
    }


def test_url_map_matches_snapshot():
    """
    КАРТА АДРЕСОВ НЕ МЕНЯЕТСЯ САМА.

    На этих адресах висят фронт, ~220 E2E, on-prem узлы и QR-ссылки. Перенос
    файлов адреса менять не должен: пропал — сломан клиент, появился лишний —
    открыли то, чего не собирались.

    Снимок обновляется ОСОЗНАННО, отдельной командой:

        docker compose exec backend python manage.py update_url_snapshot

    Автоматического обновления здесь нет намеренно: снимок, который чинит себя
    сам, — это не снимок, а зеркало.
    """
    snapshot_file = SNAPSHOTS / "url_map.json"
    assert snapshot_file.exists(), (
        "Снимка карты адресов нет. Создать: "
        "manage.py update_url_snapshot"
    )
    expected = json.loads(snapshot_file.read_text())
    current = _current_routes()

    missing = {path: methods for path, methods in expected.items() if path not in current}
    extra = {path: methods for path, methods in current.items() if path not in expected}
    changed = {
        path: {"было": expected[path], "стало": current[path]}
        for path in expected
        if path in current and expected[path] != current[path]
    }

    problems = []
    if missing:
        problems.append(
            "ПРОПАЛИ адреса (не подключён роутер?):\n  "
            + "\n  ".join(f"{path} {' '.join(methods)}" for path, methods in sorted(missing.items()))
        )
    if extra:
        problems.append(
            "ПОЯВИЛИСЬ адреса (не забыли обновить снимок?):\n  "
            + "\n  ".join(f"{path} {' '.join(methods)}" for path, methods in sorted(extra.items()))
        )
    if changed:
        problems.append(
            "СМЕНИЛИСЬ методы:\n  "
            + "\n  ".join(
                f"{path}: было {' '.join(diff['было'])}, стало {' '.join(diff['стало'])}"
                for path, diff in sorted(changed.items())
            )
        )

    assert not problems, (
        "Карта адресов разошлась со снимком.\n\n"
        + "\n\n".join(problems)
        + "\n\nЕсли изменение намеренное — обновить снимок: "
        "manage.py update_url_snapshot"
    )


# --- 2. Реестр задач Celery -------------------------------------------------


def test_celery_task_names_are_registered():
    """
    ИМЯ ЗАДАЧИ — ЭТО ПУТЬ МОДУЛЯ, и переезд файла её переименовывает.

    Молчаливее поломки не бывает: код импортируется, тесты в eager-режиме
    проходят, а воркер в проде отвечает «Received unregistered task» — ровно
    это и случилось с обновлением погоды.
    """
    from config.celery import app

    app.loader.import_default_modules()
    registered = {name for name in app.tasks if not name.startswith("celery.")}

    snapshot_file = SNAPSHOTS / "celery_tasks.json"
    expected = set(json.loads(snapshot_file.read_text()))

    missing = sorted(expected - registered)
    assert not missing, (
        "Задачи Celery ПРОПАЛИ из реестра:\n  "
        + "\n  ".join(missing)
        + "\n\nИмя задачи — путь её модуля. Если модуль переехал, воркер будет "
        "отвечать «Received unregistered task» на всё, что уже лежит в брокере. "
        "Либо вернуть модуль на место, либо задать старое имя явно: "
        "@shared_task(name='...'). Проверить, что приложение в INSTALLED_APPS и "
        "у него есть tasks.py — Celery ищет задачи только там."
    )


# --- 3. Команды manage.py ---------------------------------------------------

# Команды, без которых не живут стенд, демо и ops. Список ЯВНЫЙ: автосбор
# «сколько есть, столько и ожидаем» пропажу не заметит.
REQUIRED_COMMANDS = [
    "seed_demo_hotel",
    "seed_grms_demo",
    "check_demo_stand",
    "backfill_media_luminance",
    "fetch_seed_photos",
    "clean_test_residue",
]


def test_management_commands_are_discoverable():
    """
    Команду, уехавшую из `management/commands/`, Django просто перестаёт видеть.

    Хватится её не разработчик, а сид, уборка стенда или дежурный — то есть
    в самый неудобный момент.
    """
    from django.core.management import get_commands

    available = get_commands()
    missing = [name for name in REQUIRED_COMMANDS if name not in available]
    assert not missing, (
        "Команды manage.py ПРОПАЛИ: "
        + ", ".join(missing)
        + ". Django ищет их только в `<приложение>/management/commands/*.py` у "
        "приложений из INSTALLED_APPS — проверить путь и список приложений."
    )


# --- 4. Импорт всех модулей -------------------------------------------------


def _walk(package_name: str) -> list[str]:
    package = importlib.import_module(package_name)
    names = [package_name]
    for _finder, name, _ispkg in pkgutil.walk_packages(package.__path__, f"{package_name}."):
        # Миграции не импортируем: их исполняет Django своим порядком, а
        # импорт вне его контекста ничего не проверяет.
        if ".migrations" in name:
            continue
        names.append(name)
    return names


@pytest.mark.parametrize("package", ["apps", "api"])
def test_every_module_imports(package: str):
    """
    Ошибка импорта в модуле, который не зовёт ни один тест, живёт до первого
    обращения — то есть до гостя или до ops.

    Дешёвый способ узнать об этом сразу: пройти по всем модулям и import'нуть
    каждый.
    """
    broken: list[str] = []
    for name in _walk(package):
        try:
            importlib.import_module(name)
        except Exception as exc:  # noqa: BLE001 — причина не меняет вывода
            broken.append(f"{name}: {type(exc).__name__}: {exc}")

    assert not broken, (
        f"Модули пакета `{package}` не импортируются:\n  " + "\n  ".join(broken)
    )


# --- 5. Линт «во вьюхе нет ORM» ---------------------------------------------


def test_views_do_not_touch_orm():
    """
    Правило раскладки, записанное сторожем, а не памятью.

    Сторож знает про восемь сегодняшних мест поимённо и следит ровно за одним:
    чтобы НОВЫХ не появлялось, а старые уходили по мере разбора партий.
    Гоняется и отдельно: `python scripts/check_views.py`.
    """
    import subprocess
    import sys

    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, str(root / "scripts" / "check_views.py")],
        capture_output=True,
        text=True,
        cwd=root,
    )
    assert result.returncode == 0, result.stdout + result.stderr


# --- 6. Один путь — один модуль ---------------------------------------------


def test_each_path_is_declared_in_one_module():
    """
    Путь, объявленный в ДВУХ модулях, ломает разбор метода — и делает это тихо.

    django-ninja группирует операции по пути ВНУТРИ роутера. Если `GET /hotels`
    объявлен в одном файле, а `POST /hotels` — в другом, получаются два
    url-паттерна на один адрес: Django берёт первый и отвечает 405 на метод,
    которого в нём нет. Ни снимок карты адресов, ни сверка OpenAPI этого не
    видят — набор путей и методов остаётся прежним.

    Поймано в партии 3 переносом платформенной консоли; сторож написан, чтобы
    следующий раз это увидел прогон, а не разбор упавшего теста.
    """
    import collections

    from api import api

    where: dict[str, set[str]] = collections.defaultdict(set)

    def walk(router, prefix: str) -> None:
        # Обходим ВЛОЖЕННЫЕ роутеры тоже. Первая версия сторожа смотрела только
        # верхний уровень `api._routers` — а домены подключаются своими
        # роутерами, и все их пути лежали ниже. Сторож молчал не потому, что
        # всё в порядке, а потому, что не туда смотрел.
        for path, view in router.path_operations.items():
            for operation in view.operations:
                where[prefix + path].add(operation.view_func.__module__)
        # Запись вложенного роутера — кортеж (prefix, router, ...): длина у
        # версий ninja разная, поэтому берём первые два поля, а не всё.
        for entry in getattr(router, "_routers", []):
            sub_prefix, sub_router = entry[0], entry[1]
            walk(sub_router, prefix + sub_prefix)

    for prefix, router in api._routers:
        walk(router, prefix)

    split = {path: sorted(modules) for path, modules in where.items() if len(modules) > 1}
    assert not split, (
        "Один адрес объявлен в разных модулях — Django ответит 405 на «чужой» "
        "метод. Соберите операции пути в одном файле:\n  "
        + "\n  ".join(f"{path}: {', '.join(modules)}" for path, modules in split.items())
    )


# --- 8. Контракты не переживают свои эндпоинты ------------------------------

DOCS = Path(__file__).resolve().parents[2] / "docs"

# Путь СЧИТАЕТСЯ заявкой на эндпоинт только рядом с HTTP-методом: «GET /api/…»
# или строкой таблицы «| POST | `/api/…` |».
#
# Это не придирка к регулярке, а главный урок аудита контрактов. Жадный поиск
# «всех строк, похожих на путь» дал ШЕСТЬ «устаревших контрактов», из которых
# устаревшими оказались два: остальные четыре были объявлением префикса
# («Префиксы: /api/v1/cms»), фронтовым маршрутом внутри JSON навигации
# (`"to": "/cms/dashboard"`) и адресами вебсокетов. Сторож, который кричит на
# такое, отключают в первый же день — и вместе с ложными пропадают настоящие.
_CLAIM = re.compile(
    r"\b(?:GET|POST|PUT|PATCH|DELETE)\b[^\n]{0,40}?(/api/v1/[A-Za-z0-9_\-/{}.*]+)"
)


def _normalize(path: str) -> str:
    """`{room_id}` и `{id}` — один и тот же адрес: имя параметра не часть пути."""
    return re.sub(r"\{[^}]*\}", "{}", path.rstrip("/"))


def _contract_files() -> list[Path]:
    return sorted(DOCS.glob("*-contract*.md")) + sorted(DOCS.glob("grms/contracts/*.md"))


def test_contract_endpoints_exist_in_the_api():
    """
    КАЖДЫЙ АДРЕС, ЗАЯВЛЕННЫЙ КОНТРАКТОМ, СУЩЕСТВУЕТ.

    Документ, описывающий несуществующий эндпоинт, хуже отсутствия документа:
    по нему кто-нибудь построит интеграцию и узнает правду от 404. Именно так
    прожили годы `/cms/departments` (понятие переименовано в заведения) и
    `/api/v1/guest/menu` (псевдоним снят) — код ушёл вперёд, документы остались.

    Сторож ловит ровно этот класс и ничего больше: поля, типы и коды ответов
    сверяются машинной схемой, а не прозой (docs/api-contracts.md).
    """
    known = {_normalize(path) for path in _current_routes()}
    assert known, "карта адресов пуста — сторож смотрит не туда"

    missing: list[str] = []
    claims = 0
    for file in _contract_files():
        for number, line in enumerate(file.read_text().splitlines(), 1):
            for match in _CLAIM.finditer(line):
                claim = match.group(1).split("?")[0]
                # `GET /api/v1/guest/*` — это «весь гостевой контур», а не адрес.
                if "*" in claim:
                    continue
                claim = claim.rstrip(".,;:`)")
                claims += 1
                if _normalize(claim) not in known:
                    missing.append(f"  {file.relative_to(DOCS.parent)}:{number} — {claim}")

    assert claims > 100, f"заявок нашлось всего {claims} — сторож перестал их видеть"
    assert not missing, (
        "Контракт описывает адрес, которого в API нет. Либо эндпоинт переехал и "
        "документ надо поправить, либо строку удалить — но не оставлять:\n"
        + "\n".join(missing)
    )
