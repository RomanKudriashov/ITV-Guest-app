"""
Глобальный поиск гостя: релевантность, изоляция отеля, скрытое и настройки.

Главный тест здесь — НЕ про релевантность, а про изоляцию: поиск единственное
место продукта, куда гость передаёт произвольный текст, и цена ошибки тут не
«нашлось лишнее», а чужой отель в выдаче.
"""

from __future__ import annotations

import pytest

from apps.catalog.search import search
from apps.core.context import tenant_context

pytestmark = pytest.mark.django_db


def titles(result: dict, group: str = "items") -> list[str]:
    return [row["title"] for row in result[group]]


@pytest.fixture
def dish(crystal):
    """
    Блюдо, СОБРАННОЕ ЗДЕСЬ, а не взятое из сида.

    Сид тестов гоняется без богатого каталога — ресторанов «Терраса» и «Сакура»
    в тестовой базе нет вовсе. Тест, опирающийся на них, проверял бы не поиск, а
    набор флагов, с которыми сегодня сеют стенд.

    Слово «трюфель» стоит ТОЛЬКО в составе: именно этот случай и требовалось
    закрыть — гость помнит начинку, а не название.
    """
    from apps.catalog.models import Category, Item

    with tenant_context(crystal):
        category = Category.objects.filter(is_active=True, service__isnull=False).first()
        assert category is not None, "в отеле нет ни одной категории заведения"
        item = Item.objects.create(
            category=category,
            code="potato-truffle",
            title={"ru": "Картофель по-домашнему", "en": "Home-style potato", "zh": "家常土豆"},
            description={"ru": "Запечённый, с розмарином"},
            price=48000,
            attributes={"nutrition": {"composition": {"ru": "Картофель, трюфельное масло, тимьян"}}},
        )
    return item


def test_finds_dish_by_word_from_composition(crystal, dish):
    """
    Гость ищет «трюфель» и должен найти блюдо, даже если слово есть только в
    составе. Это прямое требование, а не бонус: состав — то, что гость помнит.
    """
    with tenant_context(crystal):
        result = search(crystal, "трюф", language="ru")

    assert "Картофель по-домашнему" in titles(result)
    # И маршрут ведёт В КАРТОЧКУ, а не в список.
    row = next(r for r in result["items"] if r["code"] == dish.code)
    assert "?item=" in row["route"]
    assert row["venue"], "в выдаче не сказано, где искать блюдо"


def test_finds_venue_by_name(crystal):
    """Заведение находится по названию, и тап ведёт в него, а не в список."""
    from apps.hotels.models import Service

    with tenant_context(crystal):
        service = Service.objects.filter(is_active=True, is_guest_facing=True).first()
        name = (service.public_title or {}).get("ru") or service.code
        result = search(crystal, name[:5], language="ru")

    assert result["services"], f"заведение «{name}» не нашлось"
    assert result["services"][0]["route"].startswith("/venue/")


def test_typos_are_forgiven(crystal, dish):
    """Опечатка не мешает: «картофил» находит картофель."""
    with tenant_context(crystal):
        result = search(crystal, "картофил", language="ru")

    assert dish.code in [row["code"] for row in result["items"]]


def test_language_does_not_hide_matches(crystal, dish):
    """
    Интерфейс английский, а название набрано по-русски — совпадение обязано
    находиться: стог сена собирается из ВСЕХ переводов сразу, а не из одного.
    """
    with tenant_context(crystal):
        result = search(crystal, "домашнему", language="en")

    assert dish.code in [row["code"] for row in result["items"]]


def test_chinese_is_found_by_substring(crystal, dish):
    """
    Китайский ищется ПОДСТРОКОЙ — и это единственное, что на нём работает:
    письмо без пробелов между словами не разбирается ни полнотекстовым поиском,
    ни триграммами. Ограничение проверено, а не заявлено.
    """
    with tenant_context(crystal):
        result = search(crystal, "土豆", language="zh")

    assert dish.code in [row["code"] for row in result["items"]]


def test_another_hotel_is_unreachable(crystal, aurora):
    """
    ИЗОЛЯЦИЯ. Ищем в «Кристалле» словом из «Авроры» — и не находим ничего.
    Отель берётся из сессии гостя, подмешать его запросом нечем.
    """
    from apps.catalog.models import Category, Item

    with tenant_context(aurora):
        category = Category.objects.filter(is_active=True).first()
        assert category is not None, "во втором отеле нет ни одной категории"
        Item.objects.create(
            category=category,
            code="aurora-secret-dish",
            title={"ru": "Аврорский секретный борщ"},
            price=100,
        )

    with tenant_context(crystal):
        result = search(crystal, "аврорский", language="ru")

    assert result["total"] == 0, f"чужой отель попал в выдачу: {result}"


def test_hidden_and_disabled_are_not_found(crystal, dish):
    """
    Гость не должен находить то, чего не может заказать: выключенная позиция,
    выключенное заведение и спрятанный от гостя сервис уходят из выдачи вместе
    со своим меню.
    """
    with tenant_context(crystal):
        item = dish
        found = lambda: [row["code"] for row in search(crystal, "картофель", language="ru")["items"]]
        assert item.code in found()

        # 1. Выключенная позиция.
        item.is_active = False
        item.save(update_fields=["is_active"])
        assert item.code not in found()
        item.is_active = True
        item.save(update_fields=["is_active"])

        # 2. Заведение спрятано от гостя — вместе с ним уходит его меню.
        service = item.category.service
        assert service is not None
        service.is_guest_facing = False
        service.save(update_fields=["is_guest_facing"])
        assert item.code not in found()

        # 3. И выключенное заведение тоже.
        service.is_guest_facing = True
        service.is_active = False
        service.save(update_fields=["is_active", "is_guest_facing"])
        assert item.code not in found()


def test_cms_settings_change_the_result(crystal, dish):
    """Настройка в CMS влияет на выдачу — иначе она украшение."""
    with tenant_context(crystal):
        code = dish.category.service.code
        assert search(crystal, "картофель", language="ru")["items"], "блюдо не нашлось"

        # Слой позиций выключен целиком.
        crystal.settings = {**(crystal.settings or {}), "search": {"layers": {"items": False}}}
        crystal.save(update_fields=["settings"])
        assert search(crystal, "картофель", language="ru")["items"] == []

        # Конкретное заведение исключено — и его меню уходит вместе с ним.
        crystal.settings = {**(crystal.settings or {}), "search": {"excluded_services": [code]}}
        crystal.save(update_fields=["settings"])
        result = search(crystal, "картофель", language="ru")
        assert all(row["venue_code"] != code for row in result["items"])
        assert all(row["code"] != code for row in result["services"])


def test_short_and_empty_queries_return_nothing(crystal):
    """
    На одном символе совпадёт половина меню. Пустой запрос — это не «покажи
    всё», а «я ещё ничего не набрал».
    """
    with tenant_context(crystal):
        assert search(crystal, "", language="ru")["total"] == 0
        assert search(crystal, "т", language="ru")["total"] == 0


def test_nothing_found_is_a_normal_answer(crystal):
    """Ничего не нашлось — пустые группы и ноль, а не ошибка."""
    with tenant_context(crystal):
        result = search(crystal, "квадрокоптер", language="ru")

    assert result["total"] == 0
    assert result["services"] == [] and result["items"] == [] and result["info"] == []
