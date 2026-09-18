"""
ЧЕГО НЕ ХВАТАЕТ: «английский — 12 из 70, арабский — 0 из 70».

Это работает уже сейчас, без всякой модели, и даёт половину пользы: отель
видит дыры в переводе и может закрыть их руками.

СЧЁТЧИК ОБЯЗАН ГОВОРИТЬ ПРАВДУ. Заполненным считается не «в ключе что-то
лежит», а «лежит текст НА ЭТОМ ЯЗЫКЕ». Русская строка под ключом `en` — не
перевод: гость увидит кириллицу в английской витрине, а отчёт скажет «всё
готово». Такие значения считаются отдельно — «похоже на чужой язык».

На демо-стенде их сейчас ноль (проверено перебором всех 815 значений отеля
«Кристалл»): сид кладёт переводы аккуратно. Но счётчик считает не сид, а то,
что наберут руками в CMS, и там ошибка ключа — дело одного вечера.

ИМЯ СОБСТВЕННОЕ — ИСКЛЮЧЕНИЕ. «Sakura» под ключом `ar` написано латиницей
намеренно (правило имён собственных), и подозрительным оно не считается.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from apps.core.fields import as_translations

from apps.translate.fields import FieldSpec, specs_for
from apps.translate.proper_nouns import is_only_proper_noun, keep_words

# Письменности языков: по ним видно, что текст не на том языке. Языку без
# своей письменности (латиница у английского) достаточно отсутствия чужой.
SCRIPTS = {
    "ru": re.compile(r"[А-Яа-яЁё]"),
    "ar": re.compile(r"[؀-ۿ]"),
    "zh": re.compile(r"[一-鿿]"),
    "en": re.compile(r"[A-Za-z]"),
}
CYRILLIC = SCRIPTS["ru"]


@dataclass
class LanguageCoverage:
    language: str
    total: int = 0
    filled: int = 0
    suspicious: int = 0
    groups: dict = field(default_factory=dict)

    @property
    def missing(self) -> int:
        return self.total - self.filled

    def as_payload(self) -> dict:
        return {
            "language": self.language,
            "total": self.total,
            "filled": self.filled,
            "missing": self.missing,
            "suspicious": self.suspicious,
            "groups": [
                {"group": name, **counts} for name, counts in sorted(self.groups.items())
            ],
        }


def looks_like(language: str, text: str) -> bool:
    """Текст похож на язык: своя письменность есть, чужой — нет."""
    body = (text or "").strip()
    if not body:
        return False
    own = SCRIPTS.get(language)
    if language == "en":
        # У латиницы нет своей приметы, зато чужая видна: кириллица под `en` —
        # это русский текст, а не перевод.
        return not CYRILLIC.search(body)
    if own is None:
        return True
    if own.search(body):
        return True
    # Арабская и китайская витрины: латиница допустима только для имени
    # собственного — «Sakura» пишется так намеренно.
    return False


def field_rows(spec: FieldSpec):
    from django.apps import apps as registry

    model = registry.get_model(spec.app_label, spec.model)
    if model is None:
        return []
    return model.objects.all().only("id", spec.field)


def coverage(languages, *, groups=None, hotel=None) -> list[dict]:
    """
    Охват по языкам. `total` — значения, которые ЕСТЬ на языке-исходнике:
    считать «из семидесяти» по пустым строкам бессмысленно.
    """
    from apps.hotels.services.hotel import current_hotel

    hotel = hotel or current_hotel()
    source = hotel.default_language or "ru"
    keep = keep_words(hotel)
    result = {code: LanguageCoverage(code) for code in languages if code != source}

    for spec in specs_for(groups):
        for row in field_rows(spec):
            values = as_translations(getattr(row, spec.field, None), source)
            origin = (values.get(source) or "").strip()
            if not origin:
                continue
            for code, stat in result.items():
                stat.total += 1
                bucket = stat.groups.setdefault(
                    spec.group, {"total": 0, "filled": 0, "suspicious": 0}
                )
                bucket["total"] += 1
                text = (values.get(code) or "").strip()
                if not text:
                    continue
                if looks_like(code, text) or is_only_proper_noun(text, keep):
                    stat.filled += 1
                    bucket["filled"] += 1
                else:
                    # Лежит, но не на том языке: гость увидит чужие буквы.
                    stat.suspicious += 1
                    bucket["suspicious"] += 1

    return [stat.as_payload() for stat in result.values()]
