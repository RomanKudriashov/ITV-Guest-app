#!/usr/bin/env python
"""
Сторож правила «ВО ВЬЮХЕ НЕТ ORM».

Правило пришло из эталонной раскладки и существовало только в голове: вьюха
разбирает запрос, зовёт сервис и возвращает схему, а ходить в базу — работа
сервиса. Пока правило не записано, после переноса оно расползётся обратно: одна
«маленькая выборка прямо здесь» тянет за собой вторую.

СПИСОК ИСКЛЮЧЕНИЙ — ЧАСТЬ СТОРОЖА, а не поблажка. Сегодня ORM во вьюхах живёт в
восьми файлах; сделать сторож красным с первого дня значит выключить его в тот
же день. Поэтому он знает про текущие места поимённо и следит ровно за одним:
чтобы НОВЫХ не появлялось, а старые уходили по мере разбора партий. Убрали ORM
из файла — строку из списка убрать; тогда следующий, кто её вернёт, узнает об
этом сразу.

    python scripts/check_views.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWS = ROOT / "api"

# Обращение к ORM: менеджер модели или конструктор запроса.
ORM = re.compile(r"\.objects\.|\bQ\(|\.select_related\(|\.prefetch_related\(")

# Файл → партия, в которой он разбирается (docs/refactor/structure-analysis.md).
# Список ТОЛЬКО сокращается. Растёт он лишь одним способом: кто-то осознанно
# решил, что новое место оправдано, и написал здесь почему.
ALLOWED = {
    "api/guest.py": "партия 2: каталог и сессия уезжают в apps/catalog, apps/accounts",
    "api/staff.py": "партия 5: персонал уезжает в apps/accounts",
    "api/platform.py": "партия 3: платформенные вьюхи уезжают в apps/hotels/api/platform",
    "api/cms/catalog.py": "партия 2: 55 эндпоинтов режутся по ресурсам apps/catalog",
    "api/cms/analytics.py": "партия 5: уезжает в apps/analytics",
    "api/cms/grms.py": "партия 4: уезжает в apps/grms/api/cms",
    "api/cms/common.py": "партия 3: уезжает в apps/hotels/api/cms",
    "api/cms/reviews.py": "партия 5: уезжает в apps/reviews",
}


def main() -> int:
    offenders: list[str] = []
    known_clean: list[str] = []

    for path in sorted(VIEWS.rglob("*.py")):
        relative = path.relative_to(ROOT).as_posix()
        hits = [
            (number, line.strip())
            for number, line in enumerate(path.read_text().splitlines(), 1)
            if ORM.search(line) and not line.strip().startswith("#")
        ]
        if hits and relative not in ALLOWED:
            first = hits[0]
            offenders.append(
                f"  {relative}:{first[0]} — {first[1][:80]}"
                + (f"  (и ещё {len(hits) - 1})" if len(hits) > 1 else "")
            )
        if not hits and relative in ALLOWED:
            known_clean.append(relative)

    if known_clean:
        print("Эти вьюхи ОЧИСТИЛИСЬ — уберите их из ALLOWED в scripts/check_views.py:")
        for relative in known_clean:
            print(f"  {relative}")
        print()

    if offenders:
        print("ORM во вьюхе. Выборка — работа сервиса, вьюха её зовёт:")
        print("\n".join(offenders))
        print(
            "\nЛибо перенести выборку в apps/<домен>/services/, либо — если место "
            "осознанно временное — добавить файл в ALLOWED с номером партии, "
            "в которой он разбирается (docs/refactor/structure-analysis.md)."
        )
        return 1

    print(f"ORM только в сервисах; известных исключений {len(ALLOWED)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
