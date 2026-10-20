"""
Меню гостя: бюджет запросов и кэш (партия 61).

Меню «Саввы» Метрополя (798 позиций) собиралось за 4399 SQL-запросов и
десять секунд — по пять запросов на позицию. Бюджет ниже держит число
запросов НЕЗАВИСИМЫМ от числа позиций. Кэш собранного меню не имеет права
прятать правку: изменённое в CMS гость видит следующим же запросом.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.catalog.services.menu import MenuOptions, build_menu
from apps.core.context import language_context, tenant_context
from tests.conftest import host_for

pytestmark = pytest.mark.django_db

BUDGET = 20


def _queries(hotel, point: str) -> int:
    with tenant_context(hotel), language_context("ru"):
        with CaptureQueriesContext(connection) as captured:
            build_menu(MenuOptions(language="ru", point_code=point), hotel=hotel)
    return len(captured.captured_queries)


def test_menu_query_count_does_not_grow_with_items(crystal):
    call_command("seed_big_menu", "--subdomain", crystal.subdomain, "--service", "small60", "--categories", "3", "--items", "6")
    call_command("seed_big_menu", "--subdomain", crystal.subdomain, "--service", "large60", "--categories", "12", "--items", "60")
    small = _queries(crystal, "small60")
    large = _queries(crystal, "large60")
    assert large <= BUDGET, f"меню на 60 позиций — {large} запросов при бюджете {BUDGET}"
    # Не растёт с объёмом: десятикратное меню — то же число запросов.
    assert large == small, f"запросов {small} на 6 позиций и {large} на 60 — где-то N+1"


def _menu(client, hotel, token, point="kitchen"):
    response = client.get(
        f"/api/v1/guest/catalog?type=product&point={point}&lang=ru",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert response.status_code == 200, response.content
    return response.json()


def _item(menu, item_id):
    return next(i for c in menu["categories"] for i in c["items"] if i["id"] == item_id)


def test_cms_edit_is_visible_to_the_guest_at_once(client, crystal, cms, guest_token):
    menu = _menu(client, crystal, guest_token)
    item = menu["categories"][0]["items"][0]

    # Заголовок.
    cms.patch(f"/api/cms/items/{item['id']}", {"title": {"ru": "Новое имя блюда"}})
    assert _item(_menu(client, crystal, guest_token), item["id"])["title"] == "Новое имя блюда"

    # Стоп-лист.
    cms.post(f"/api/cms/items/{item['id']}/stock", {"in_stock": False})
    assert _item(_menu(client, crystal, guest_token), item["id"])["is_available"] is False

    # Метка.
    from apps.hotels.models import HotelModule

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(code="marketing", defaults={"is_enabled": True})
    badge = cms.post("/api/cms/badges", {"label": {"ru": "Сезон"}, "color_role": "accent"}).json()
    cms.put(f"/api/cms/badges/{badge['id']}/items/{item['id']}", {"attached": True})
    assert "Сезон" in [b["label"] for b in _item(_menu(client, crystal, guest_token), item["id"])["badges"]]


def test_a_cached_menu_answers_with_few_queries_and_fresh_server_time(client, crystal, guest_token):
    first = _menu(client, crystal, guest_token)
    with CaptureQueriesContext(connection) as captured:
        second = _menu(client, crystal, guest_token)
    # Попадание: проверка сессии и один отпечаток данных — без сборки меню.
    assert len(captured.captured_queries) <= 6, [q["sql"][:80] for q in captured.captured_queries]
    assert second["categories"] == first["categories"]
    assert second["server_time"] >= first["server_time"]
