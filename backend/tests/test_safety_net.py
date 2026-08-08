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
