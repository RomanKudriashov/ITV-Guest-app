#!/usr/bin/env python3
"""
Разбить набор e2e на три части ПО РАЗДЕЛАМ ПРОДУКТА (партия 25).

    python3 scripts/split-parts.py set.txt out-dir
    # set.txt — по файлу спеки в строке (tests/brand.spec.ts ...)
    # out-dir/part-A.txt, part-B.txt, part-C.txt

А — бренд, показ, главная, консоль платформы;
В — номер, трекер, уведомления, пульт, панель сервисов, лендинг платформы;
Б — всё остальное: витрина гостя и заказ.

Делим по разделам, а не «по алфавиту поровну»: красная сразу говорит, где
искать, а соседние по смыслу проверки делят состояние стенда (бренд, корзина,
GRMS) и не мешают друг другу через раздел. Поровну — по времени, а не по
числу тестов: тесты бренда тяжелее (обходят экраны), поэтому в А их меньше.
"""
import re
import sys
from pathlib import Path

A = re.compile(r"(brand|home-|entry|image-|item-editor|cms-gutters|admin-|platform-)")
C = re.compile(r"(room-|tracker-|escalation|notifications|dashboard|cms-reorg|address-scheme|landing-)")


def part(name: str) -> str:
    if A.match(name):
        return "A"
    if C.match(name):
        return "C"
    return "B"


def main() -> None:
    files = [line.strip() for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[str, list[str]] = {"A": [], "B": [], "C": []}
    for path in files:
        parts[part(Path(path).name)].append(path)
    for key, paths in parts.items():
        (out / f"part-{key}.txt").write_text("\n".join(sorted(paths)) + "\n")
        print(f"part {key}: {len(paths)} файлов")


if __name__ == "__main__":
    main()
