#!/usr/bin/env python3
"""
СТОРОЖ НАБОРА ПЕРЕМЕННЫХ СТЕНДА (п.7 бэклога).

    python3 infra/check-env.py .env.prod [docker-compose.prod.yml]

Сверяет набор переменных с тем, что compose подставляет в `${...}`.
Обязательна переменная без значения по умолчанию — `${X}`, `${X?…}`,
`${X:?…}`; с `${X:-…}` или `${X-…}` — нет. Пустое значение обязательной —
тоже пропуск: compose подставит пустую строку молча.

ЗАЧЕМ. Пропущенный `POSTGRES_SUPERUSER` давал postgres, который поднимается,
и healthcheck с пустым `-U`: вся сборка не стартовала с невнятным
«dependency failed to start», и искали не там. Проверка на секунду ловит
целый простой.

Значения не печатаются никогда — только имена: в наборе пароли и токены.
Код возврата 1 — чего-то не хватает.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?+][^}]*)?\}")


def required_names(compose_text: str) -> set[str]:
    names: set[str] = set()
    for name, modifier in REFERENCE.findall(compose_text):
        if not modifier or modifier.lstrip(":").startswith("?"):
            names.add(name)
    return names


def env_values(env_text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in env_text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.removeprefix("export ").strip()
        values[key] = value.strip().strip('"').strip("'")
    return values


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    env_path = Path(argv[1])
    compose_path = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parent.parent / "docker-compose.prod.yml"
    required = required_names(compose_path.read_text(encoding="utf-8"))
    values = env_values(env_path.read_text(encoding="utf-8"))
    missing = sorted(name for name in required if name not in values)
    empty = sorted(name for name in required if name in values and not values[name])
    if missing or empty:
        if missing:
            print(f"НЕТ в {env_path.name}: {', '.join(missing)}")
        if empty:
            print(f"ПУСТО в {env_path.name}: {', '.join(empty)}")
        print(f"compose ({compose_path.name}) требует {len(required)} переменных — набор неполон")
        return 1
    print(f"набор полон: {len(required)} обязательных переменных compose есть в {env_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
