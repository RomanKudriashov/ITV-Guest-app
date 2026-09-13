"""
ПРИМЕНИМОСТЬ СПРАВОЧНИКОВ ПО ТИПАМ.

Главное здесь — не то, что неприменимое скрыто, а то, что скрытие ничего не
стирает. Настройку пробуют в первый же день, и отель, потерявший на этом
проставленные руками аллергены, второй раз её не тронет.
"""

from __future__ import annotations

import pytest

from apps.catalog.facet_scope import FacetKind, applies, entry_scope, kind_applies, kind_scope
from apps.catalog.nouns import OfferingNoun
from apps.core.context import tenant_context

pytestmark = pytest.mark.django_db


# --- Правило ----------------------------------------------------------------


def test_dictionaries_are_meaningless_for_a_service():
    """Массаж не содержит глютена — и это свойство справочника, а не отеля."""
    assert kind_applies(FacetKind.ALLERGENS, OfferingNoun.DISH)
    assert kind_applies(FacetKind.ALLERGENS, OfferingNoun.GOODS)
    assert not kind_applies(FacetKind.ALLERGENS, OfferingNoun.SERVICE)
    assert not kind_applies(FacetKind.MARKERS, OfferingNoun.PAGE)


def test_empty_narrowing_means_the_whole_dictionary():
    """
    Пусто — это «как у справочника», а не «нигде».

    Разница решающая: записи, которых отель не трогал, обязаны вести себя как
    до появления настройки. Прочти мы пустой список как «нигде», аллергены
    исчезли бы у всех разом в день выкатки.
    """
    assert entry_scope(FacetKind.ALLERGENS, []) == kind_scope(FacetKind.ALLERGENS)
    assert entry_scope(FacetKind.ALLERGENS, None) == kind_scope(FacetKind.ALLERGENS)
    assert applies(FacetKind.ALLERGENS, [], OfferingNoun.DISH)


def test_narrowing_cannot_widen_beyond_the_dictionary():
    """
    Сузить можно, расширить сверх справочника — нет.

    Аллерген, объявленный применимым к странице, не стал бы от этого
    осмысленным, зато сломал бы обещание уровня справочника.
    """
    scope = entry_scope(FacetKind.ALLERGENS, [OfferingNoun.PAGE, OfferingNoun.DISH])
    assert scope == frozenset({OfferingNoun.DISH})
    assert not applies(FacetKind.ALLERGENS, [OfferingNoun.PAGE], OfferingNoun.PAGE)


def test_unknown_dictionary_shows_everywhere():
    """
    Незнакомый справочник применим везде.

    Умолчание широкое намеренно: новый справочник, про который здесь ещё не
    написали строку, должен вести себя как раньше — показываться, — а не
    исчезнуть молча со всех карточек.
    """
    assert kind_applies("tastes", OfferingNoun.SERVICE)


# --- Сужение не стирает данных ---------------------------------------------


def test_narrowing_hides_but_keeps_the_links(cms, crystal):
    """
    Сузили — пропало с экрана; вернули — всё на месте.

    Проверяется именно ПАРА действий: проверка «пропало» в одиночку зеленела бы
    и на коде, который честно удаляет связи.

    КОНТЕКСТ ОТЕЛЯ БЕРЁТСЯ ЯВНО ВОКРУГ КАЖДОГО ЗАПРОСА К БАЗЕ. Ходка по HTTP
    проходит через middleware, который контекст ставит и на выходе снимает, —
    после неё менеджер модели фильтрует по «нет отеля» и отдаёт ноль строк.
    Первая редакция этого укуса на том и попалась: связи были на месте, а
    проверка читала пустоту и сообщала о потере данных.
    """
    from apps.catalog.models import Allergen
    from apps.catalog.models.facets import ItemAllergen

    with tenant_context(crystal):
        allergen = Allergen.objects.filter(item_allergens__isnull=False).first()
        if allergen is None:
            pytest.skip("в сиде нет проставленных аллергенов — проверять нечего")
        allergen_id = allergen.pk
        before = ItemAllergen.objects.filter(allergen_id=allergen_id).count()
    assert before, "выбран аллерген без связей — проверка бессмысленна"

    # Сузили до товара: у блюда запись показываться перестала.
    response = cms.patch(f"/api/cms/allergens/{allergen_id}", {"applies_to": ["goods"]})
    assert response.status_code == 200
    assert response.json()["scope"] == ["goods"]

    listing = cms.get("/api/cms/allergens?noun=dish").json()
    assert all(row["id"] != str(allergen_id) for row in listing["items"])

    # СВЯЗИ НА МЕСТЕ. Ровно то, ради чего это правило и написано.
    with tenant_context(crystal):
        assert ItemAllergen.objects.filter(allergen_id=allergen_id).count() == before

    # Вернули — снова видна.
    back = cms.patch(f"/api/cms/allergens/{allergen_id}", {"applies_to": []})
    assert back.status_code == 200
    listing = cms.get("/api/cms/allergens?noun=dish").json()
    assert any(row["id"] == str(allergen_id) for row in listing["items"])
    with tenant_context(crystal):
        assert ItemAllergen.objects.filter(allergen_id=allergen_id).count() == before


def test_service_gets_no_allergen_dictionary_at_all(cms):
    """
    У услуги справочника нет вовсе — и ответ это говорит прямо.

    `kind_applies=false` отличается от пустого списка: первое просит убрать
    раздел с экрана, второе — завести запись. Экран рисует по этому флагу, а не
    по длине списка.
    """
    payload = cms.get("/api/cms/allergens?noun=service").json()
    assert payload["kind_applies"] is False
    assert payload["items"] == []

    dishes = cms.get("/api/cms/allergens?noun=dish").json()
    assert dishes["kind_applies"] is True
    assert dishes["items"], "у блюда справочник аллергенов пуст — сид сломан"
