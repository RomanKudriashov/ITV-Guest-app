"""
Реестр переводов демо-содержимого: арабский и китайский к ru/en.

Проверяется то, из-за чего витрина и выглядела наполовину английской: язык
интерфейса переключался, а карточки оставались на английском, потому что
других языков в них просто не было.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.seed_translations import (
    CHARACTERISTIC_TEXTS,
    COMPOSITIONS,
    MODIFIER_TEXTS,
    TRANSLATIONS,
    fill_translations,
)

pytestmark = pytest.mark.django_db

LANGS = ("ar", "zh")


def test_every_entry_carries_both_languages():
    """
    Полузаполненная строка хуже пустой: гость на китайском получил бы арабский.

    Сторож статический и потому дешёвый — он ловит опечатку в реестре в тот
    момент, когда её сделали, а не на показе.
    """
    for code, fields in TRANSLATIONS.items():
        for field, languages in fields.items():
            missing = [lang for lang in LANGS if not (languages.get(lang) or "").strip()]
            assert not missing, f"{code}.{field}: нет {missing}"

    for registry, name in (
        (COMPOSITIONS, "COMPOSITIONS"),
        (CHARACTERISTIC_TEXTS, "CHARACTERISTIC_TEXTS"),
        (MODIFIER_TEXTS, "MODIFIER_TEXTS"),
    ):
        for key, languages in registry.items():
            missing = [lang for lang in LANGS if not (languages.get(lang) or "").strip()]
            assert not missing, f"{name}[{key}]: нет {missing}"


def test_seeded_hotel_comes_out_translated(crystal):
    """
    Сид оставляет карточки ПЕРЕВЕДЁННЫМИ — все четыре языка сразу.

    Это и есть требование целиком: гость переключает интерфейс на китайский и
    видит китайские названия, а не английские с китайским меню вокруг.
    """
    from apps.catalog.models import Item

    with tenant_context(crystal):
        item = Item.objects.filter(code="ribeye").first()
        assert item is not None, "в демо-отеле нет позиции, на которой это проверять"
        for language in ("ru", "en", *LANGS):
            assert (item.title.get(language) or "").strip(), f"нет названия на «{language}»"


def test_fill_adds_missing_languages_and_keeps_the_rest(crystal):
    """Дописывает недостающее и НЕ трогает того, что уже написано."""
    from apps.catalog.models import Item

    with tenant_context(crystal):
        item = Item.objects.get(code="ribeye")
        # Снимаем переводы — так выглядела карточка до этого прогона.
        item.title = {"ru": item.title["ru"], "en": item.title["en"]}
        item.save(update_fields=["title", "updated_at"])

        filled = fill_translations()
        assert filled.get("ar") and filled.get("zh")

        item.refresh_from_db()
        assert item.title["zh"] == TRANSLATIONS["ribeye"]["title"]["zh"]
        assert item.title["ar"] == TRANSLATIONS["ribeye"]["title"]["ar"]
        # Написанное раньше осталось как было.
        assert item.title["ru"] == "Стейк рибай"
        assert item.title["en"] == "Ribeye steak"


def test_hand_written_translation_survives_reseeding(crystal):
    """
    Правка администратора СИЛЬНЕЕ реестра.

    Иначе сид превращается в откат чужой работы: отель перевёл блюдо по-своему,
    прогнали пересев — и перевод вернулся к нашему.
    """
    from apps.catalog.models import Item

    with tenant_context(crystal):
        item = Item.objects.get(code="ribeye")
        item.title = {"ru": item.title["ru"], "zh": "我们的牛排"}
        item.save(update_fields=["title", "updated_at"])

        fill_translations()

        item.refresh_from_db()
        assert item.title["zh"] == "我们的牛排"
        # А пустой язык всё равно дописан.
        assert item.title["ar"] == TRANSLATIONS["ribeye"]["title"]["ar"]


def test_second_run_changes_nothing(crystal):
    """Идемпотентность: реестр применяется при каждом пересеве."""
    from apps.catalog.models import Item

    with tenant_context(crystal):
        item = Item.objects.get(code="ribeye")
        item.title = {"ru": item.title["ru"]}
        item.save(update_fields=["title", "updated_at"])

        assert fill_translations()
        # Сид отработал ещё до теста, поэтому пустого не осталось вовсе.
        assert fill_translations() == {}
