"""
ПУСТО — ЭТО ОТВЕТ, А НЕ ОШИБКА.

Отель без единого заказа — не редкость и не поломка: так выглядит КАЖДЫЙ отель
в день запуска, ровно тогда, когда его владелец первый раз открывает аналитику.
Разрез по точкам отвечал ему `IndexError`: `_sort_rows` заводил пустой список
внутрь ветки, которая первым же действием читает `rows[0]`.

Здесь проверяются ВСЕ разрезы разом, а не один починенный: падало одно место,
но пустой набор проходит через все семь, и чинить по одному — значит узнавать
о следующем от клиента.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.services.provisioning import provision_hotel

from tests.conftest import CmsClient, host_for

pytestmark = pytest.mark.django_db

# Все разрезы, которые открывает вкладка аналитики. `scope` идёт первым: он
# отвечает «что тебе вообще доступно», и без него остальные не спрашивают.
CUTS = [
    "scope",
    "summary",
    "timeseries",
    "breakdown",
    "operations",
    "traffic",
    "reviews",
    "drilldown",
]


@pytest.fixture
def fresh_cms(client, db):
    """
    ОТЕЛЬ В ДЕНЬ ЗАПУСКА: заведён, админ есть, заказов нет ни одного.

    Не `aurora` из сида: тот заводится вместе с демо-данными, и «пусто» у него
    случайно, а не по построению. Здесь пустота — свойство фикстуры.
    """
    password = "brandnew12345"
    result = provision_hotel(
        subdomain="brandnew",
        name="Новый",
        admin_email="admin@brandnew.test",
        admin_password=password,
    )
    hotel = result.hotel
    # Свой вход, а не `staff_token_for`: тот собирает адрес по образцу сида
    # (`chef@crystal.local`), а этот отель заведён руками и с другим адресом.
    response = client.post(
        "/api/staff/auth/login",
        data={"email": result.admin.email, "password": password},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return CmsClient(client, hotel, response.json()["access"])


@pytest.mark.parametrize("cut", CUTS)
def test_every_cut_opens_on_a_hotel_without_orders(fresh_cms, cut):
    response = fresh_cms.get(f"/api/cms/analytics/{cut}?preset=month")
    assert response.status_code == 200, f"{cut}: {response.status_code} {response.content[:400]}"


@pytest.mark.parametrize("dimension", ["point", "item", "category", "location"])
def test_breakdown_is_empty_not_broken_for_every_dimension(fresh_cms, dimension):
    """
    Разрез просят по измерению, и подпись каждого резолвится своим запросом.
    Пустой ключевой список не должен ронять ни один из них.
    """
    response = fresh_cms.get(f"/api/cms/analytics/breakdown?preset=month&dimension={dimension}")
    assert response.status_code == 200, response.content[:400]
    assert response.json()["rows"] == []


def test_sorting_an_empty_cut_is_not_an_error(fresh_cms):
    """
    Явная сортировка — отдельная ветка кода. Пустой набор обязан пройти и её:
    «нечего сортировать» и «не сказали, по чему сортировать» — разные случаи.
    """
    for query in ("", "&sort=orders", "&sort=revenue_minor&order=asc"):
        response = fresh_cms.get(f"/api/cms/analytics/operations?preset=month{query}")
        assert response.status_code == 200, f"{query}: {response.content[:400]}"
        assert response.json()["by_point"] == []


def test_the_hotel_really_has_nothing_to_show(fresh_cms):
    """
    Сторож самой проверки: если у отеля вдруг появятся заказы, тесты выше
    начнут проходить по другой причине и перестанут ловить свой дефект.
    """
    from apps.analytics.models import OrderDaily
    from apps.orders.models import Order

    with tenant_context(fresh_cms.hotel):
        assert Order.objects.count() == 0
        assert OrderDaily.objects.count() == 0
