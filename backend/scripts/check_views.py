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

# ГДЕ ИСКАТЬ ВЬЮХИ. Смотреть только в `api/` было достаточно ровно до тех пор,
# пока вьюхи там жили. С партии 2 они переезжают в свои домены — и сторож,
# который об этом не знает, позеленел бы не потому, что ORM ушла из вьюх, а
# потому, что вьюхи ушли из его поля зрения. Это худший вид зелёного.
VIEW_ROOTS = [ROOT / "api", *sorted((ROOT / "apps").glob("*/api"))]

# Обращение к ORM: менеджер модели или конструктор запроса.
ORM = re.compile(r"\.objects\.|\bQ\(|\.select_related\(|\.prefetch_related\(")

# Файл → партия, в которой он разбирается (docs/refactor/structure-analysis.md).
# Список ТОЛЬКО сокращается. Растёт он лишь одним способом: кто-то осознанно
# решил, что новое место оправдано, и написал здесь почему.
ALLOWED = {
    # Каталог отсюда уехал (партия 2). Осталась выборка локаций доставки —
    # это модель отеля, и сервис ей нужен в apps/hotels.
    "api/guest.py": "партия 3: локации доставки уезжают в apps/hotels",
    "api/staff.py": "партия 5: персонал уезжает в apps/accounts",
    "api/cms/analytics.py": "партия 5: уезжает в apps/analytics",
    "api/cms/reviews.py": "партия 5: уезжает в apps/reviews",
}


def main() -> int:
    offenders: list[str] = []
    known_clean: list[str] = []

    seen: set[str] = set()
    for root in VIEW_ROOTS:
        for path in sorted(root.rglob("*.py")):
            relative = path.relative_to(ROOT).as_posix()
            seen.add(relative)
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

    # Файл из списка исчез — значит вьюха переехала или удалена, и запись
    # протухла. Молчать об этом нельзя: список исключений живёт ровно до тех
    # пор, пока каждая строка в нём означает конкретное место в коде.
    known_clean.extend(sorted(set(ALLOWED) - seen))

    if known_clean:
        # КРАСНЫМ, а не заметкой. Сторож, который замечает протухшую строку и
        # всё равно отвечает «всё хорошо», — это сторож, чей список исключений
        # через три партии перестанет что-либо значить.
        print("Эти вьюхи ОЧИСТИЛИСЬ — уберите их из ALLOWED в scripts/check_views.py:")
        for relative in known_clean:
            print(f"  {relative}")
        print()
        return 1

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
