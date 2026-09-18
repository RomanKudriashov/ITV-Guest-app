"""
ИМЕНА СОБСТВЕННЫЕ НЕ ПЕРЕВОДЯТСЯ — правило одно на сид и на автоперевод.

Оно уже жило в реестре демо-переводов (`apps/hotels/seed_translations.py`):
«Кристалл», «Панорама», «Сакура», «Марина», «Лагуна», «Талассо», «Люмен» в
арабском и китайском остаются латиницей — так их пишут на вывеске и в картах,
и гость, идущий по указателю, видит то же слово. Переводится всё вокруг имени:
«ресторан», «бар», «СПА».

Здесь оно вынесено в одно место и читается обеими сторонами: второй список
разошёлся бы с первым на первом же новом отеле.
"""

from __future__ import annotations

import re

# Имена собственные демо-флота: они же — примеры правила. Список пополняется
# отелем (см. `hotel.settings["translation"]["keep"]`), а не только кодом.
SEED_NAMES: tuple[str, ...] = (
    "Кристалл", "Crystal",
    "Панорама", "Panorama",
    "Сакура", "Sakura",
    "Марина", "Marina",
    "Лагуна", "Laguna",
    "Талассо", "Thalasso",
    "Люмен", "Lumen",
    "Азур", "Azure",
)


def keep_words(hotel) -> tuple[str, ...]:
    """Слова, которые модель обязана оставить как есть."""
    own = ((hotel.settings or {}).get("translation") or {}).get("keep") or []
    own = [str(word).strip() for word in own if str(word).strip()]
    return tuple(dict.fromkeys([*SEED_NAMES, *own]))


def protected(text: str, words: tuple[str, ...]) -> tuple[str, ...]:
    """Какие из охраняемых слов встретились в тексте — их и передаём модели."""
    found = []
    for word in words:
        if re.search(rf"(?<!\w){re.escape(word)}(?!\w)", text, flags=re.IGNORECASE):
            found.append(word)
    return tuple(found)


def is_only_proper_noun(text: str, words: tuple[str, ...]) -> bool:
    """
    Строка — ТОЛЬКО имя собственное («Сакура»): переводить нечего, и платить
    модели за копию слова незачем. Такие значения прогон переносит как есть.
    """
    stripped = re.sub(r"[«»\"'`\s]+", " ", text or "").strip()
    return bool(stripped) and any(stripped.casefold() == word.casefold() for word in words)
