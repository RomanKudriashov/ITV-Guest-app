"""
СЛОВО КАТАЛОГА: выводится из типа заведения и доезжает до экранов.

Проверяется не карта сама по себе — её полноту стережёт
`test_guest_card_covers_every_service_type`, — а то, ради чего она заведена:
что экран получает слово в ответе и что спа не назовёт свои позиции блюдами.
"""

from __future__ import annotations

import pytest

from apps.catalog.nouns import OfferingNoun, noun_for_service, noun_for_service_type

pytestmark = pytest.mark.django_db


# --- Карта ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("service_type", "expected"),
    [
        ("restaurant", OfferingNoun.DISH),
        ("bar", OfferingNoun.DISH),
        ("room_service", OfferingNoun.DISH),
        ("spa", OfferingNoun.SERVICE),
        ("pool", OfferingNoun.SERVICE),
        ("transfer", OfferingNoun.SERVICE),
        ("concierge", OfferingNoun.SERVICE),
        ("excursions", OfferingNoun.SERVICE),
        ("housekeeping", OfferingNoun.SERVICE),
        ("minibar", OfferingNoun.GOODS),
        ("info", OfferingNoun.PAGE),
        ("custom", OfferingNoun.ITEM),
    ],
)
def test_every_service_type_says_its_word(service_type, expected):
    """Карта целиком, строка за строкой: она и есть договорённость с отелем."""
    assert noun_for_service_type(service_type) == expected


def test_unknown_service_type_falls_back_to_the_neutral_word():
    """
    Незнакомый тип — «позиция», а не «блюдо».

    Умолчание здесь единственное безопасное: назвать содержимое блюдом наугад
    значит ошибиться у всех, кто завёл этот тип именно потому, что не подошли
    остальные. Проверка стоит отдельно, потому что умолчание — это ровно то
    место, которое ломают, добавляя тип и забывая строку в карте.
    """
    assert noun_for_service_type("teleport") == OfferingNoun.ITEM
    assert noun_for_service_type("") == OfferingNoun.ITEM
    assert noun_for_service(None) == OfferingNoun.ITEM


# --- Слово доезжает до экрана ----------------------------------------------


def test_service_payload_carries_the_word(cms):
    """
    Заведение отдаёт слово вместе с типом.

    Без этого рабочее пространство сервиса знало бы тип, но не слово, и
    вывод карты пришлось бы повторить на фронте ТРЕТЬИМ экземпляром.
    """
    response = cms.get("/api/cms/services")
    assert response.status_code == 200
    rows = response.json()["items"]
    assert rows, "на стенде нет заведений — проверять нечего"
    for row in rows:
        assert row["noun"] == noun_for_service_type(row["type"]), row["code"]


def test_category_payload_carries_the_word(cms):
    """
    Раздел несёт слово с собой.

    Редактор позиции открывается по прямой ссылке, когда заведение экрану
    неизвестно, а раздел известен всегда: он в форме. Слово на разделе — это
    то, что делает «Новая услуга» возможной без второго запроса.
    """
    response = cms.get("/api/cms/categories")
    assert response.status_code == 200
    rows = response.json()
    assert rows, "на стенде нет разделов — проверять нечего"

    def walk(nodes):
        for node in nodes:
            yield node
            yield from walk(node.get("children") or [])

    for node in walk(rows):
        assert node["noun"] in set(OfferingNoun.values), node["code"]


def test_spa_categories_never_say_dish(cms, in_crystal):
    """
    Ради этого всё и делалось: в спа слово не ресторанное.

    Проверка именно на выдаче, а не на карте: карту можно завести правильную и
    забыть отдать её экрану — и на кнопке останется «Добавить блюдо».
    """
    from apps.hotels.models import Service

    spa = Service.objects.filter(type=Service.Type.SPA).first()
    if spa is None:
        pytest.skip("в сиде нет спа — проверять нечего")

    response = cms.get(f"/api/cms/categories?service_id={spa.pk}")
    assert response.status_code == 200
    nodes = response.json()
    assert nodes, "у спа нет разделов — проверять нечего"
    for node in nodes:
        assert node["noun"] == OfferingNoun.SERVICE, node["code"]
