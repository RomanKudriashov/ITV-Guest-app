#!/usr/bin/env python3
"""
Тот ли код на стенде: карта адресов стенда против снимка репозитория.

ЗАЧЕМ ИМЕННО ЭТА ПРОВЕРКА. На стенде код ЗАПЕЧЁН В ОБРАЗ, а не смонтирован.
Забыть пересобрать образ — и стенд молча работает по вчерашнему коду: экраны
открываются, ручки отвечают, всё зелёное, а половины волны нет. Мы на этом уже
обжигались, и ловили руками. Здесь ловится одной командой:

    python3 backend/scripts/check_stand_api.py https://crystal.app.147.45.245.172.sslip.io

Сверяется ПЕРЕЧЕНЬ АДРЕСОВ И МЕТОДОВ, а не тела ответов: схема OpenAPI живёт на
стенде сама и не требует ни входа, ни данных. Появился адрес в коде — он обязан
быть на стенде; пропал на стенде — образ старый.

ЧТО ЭТО НЕ ДОКАЗЫВАЕТ. Совпадение карты не значит, что совпало поведение: две
сборки с одинаковым набором адресов могут по-разному считать. Это дешёвая
проверка на «доехал ли код вообще», и она честно отвечает только на этот
вопрос.

Код возврата: 0 — карты совпали, 1 — разошлись, 2 — стенд не ответил.
Зависимостей нет: только стандартная библиотека, гоняется с хоста.
"""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parent.parent / "tests" / "snapshots" / "url_map.json"
# Префикс версии в снимке есть, в схеме стенда он уже внутри путей. Сравниваем
# по общему виду, иначе разойдутся ВСЕ 272 адреса — на пустом месте.
PREFIX = "/api/v1"
TIMEOUT = 30


def stand_paths(base: str) -> dict[str, set[str]]:
    url = base.rstrip("/") + "/api/v1/openapi.json"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT, context=ssl.create_default_context()) as answer:
            spec = json.loads(answer.read().decode())
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"Стенд не отдал схему ({url}): {exc}")
        raise SystemExit(2) from exc

    out: dict[str, set[str]] = {}
    for path, methods in (spec.get("paths") or {}).items():
        short = path[len(PREFIX):] if path.startswith(PREFIX) else path
        out[short] = {m.upper() for m in methods if m.lower() != "parameters"}
    return out


def snapshot_paths() -> dict[str, set[str]]:
    rows = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    return {
        (path[len(PREFIX):] if path.startswith(PREFIX) else path): set(methods)
        for path, methods in rows.items()
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip())
        return 2
    base = sys.argv[1]

    stand = stand_paths(base)
    snapshot = snapshot_paths()

    missing = sorted(set(snapshot) - set(stand))
    extra = sorted(set(stand) - set(snapshot))
    differing = sorted(
        path for path in set(stand) & set(snapshot) if stand[path] != snapshot[path]
    )

    print(f"адресов в снимке {len(snapshot)}, на стенде {len(stand)}")

    if not (missing or extra or differing):
        print("карта адресов совпала: на стенде тот же код")
        return 0

    # Каждый вид расхождения — со своим смыслом, а не общим «не совпало»:
    # «нет на стенде» почти всегда значит старый образ, «нет в снимке» —
    # забытый `manage.py update_url_snapshot`.
    if missing:
        print(f"\nЕСТЬ В КОДЕ, НЕТ НА СТЕНДЕ ({len(missing)}) — образ старый, пересоберите:")
        for path in missing:
            print(f"  {path}")
    if extra:
        print(f"\nЕСТЬ НА СТЕНДЕ, НЕТ В СНИМКЕ ({len(extra)}) — снимок отстал:")
        for path in extra:
            print(f"  {path}")
    if differing:
        print(f"\nРАЗНЫЕ МЕТОДЫ ({len(differing)}):")
        for path in differing:
            print(f"  {path}: в снимке {sorted(snapshot[path])}, на стенде {sorted(stand[path])}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
