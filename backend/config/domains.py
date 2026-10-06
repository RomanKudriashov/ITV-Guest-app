"""
БАЗЫ АДРЕСОВ ПЛАТФОРМЫ — ОДНО МЕСТО (партия 39).

Отели живут по адресу `<код>.<база>`, консоль платформы и лендинг — на самой
базе. Баз может быть НЕСКОЛЬКО: переезд на новый домен не обрывает старые
адреса (напечатанные QR, закладки, письма). Список задаётся одной
переменной `APP_DOMAINS` через запятую; ПЕРВАЯ база — главная: по ней
строятся все адреса наружу (QR, письма, бот, приглашения). Старая
`APP_DOMAIN` — список из одной базы.

Здесь — чистые функции без Django: из них `settings.py` выводит разрешённые
хосты и доверенные источники форм, а тесты проверяют вывод напрямую.
Перечислять адреса руками где-то ещё — значит однажды забыть одну из баз.
"""

from __future__ import annotations


def parse_bases(raw: str) -> list[str]:
    """`a.ru, .b.ru,A.RU` → ['a.ru', 'b.ru']: порядок сохраняется, повторы уходят."""
    bases: list[str] = []
    for part in (raw or "").split(","):
        base = part.strip().strip(".").lower()
        if base and base not in bases:
            bases.append(base)
    return bases


def allowed_hosts(bases: list[str]) -> list[str]:
    """Каждая база и все её поддомены (`.база` — шаблон Django) плюс адреса машины."""
    hosts: list[str] = []
    for base in bases:
        hosts += [f".{base}", base]
    return hosts + ["localhost", "127.0.0.1"]


def csrf_trusted_origins(bases: list[str]) -> list[str]:
    """Источники форм: поддомены и сама база (консоль живёт на базе), обе схемы."""
    origins: list[str] = []
    for base in bases:
        origins += [f"https://*.{base}", f"http://*.{base}", f"https://{base}", f"http://{base}"]
    return origins
