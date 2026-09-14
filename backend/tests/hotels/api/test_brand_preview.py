"""
Показ витрины: заведение выбирает СЕРВЕР.

Экран заведения открывается по коду, и код у каждого отеля свой. Пока показ
выбирал заведение сам, в нём жила зашитая «кухня»: на демо-стенде совпадало, у
любого другого отеля экран сказал бы «заведение не найдено». Здесь проверяется
ровно это место — что выбор делается по данным отеля, а не по константе, и что
отсутствие заведений отвечается честно, а не пустым каталогом «как бы отеля».
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Service

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _preview(cms, screen: str, **params):
    query = "&".join(f"{key}={value}" for key, value in params.items())
    path = f"/api/cms/brand/preview?screen={screen}" + (f"&{query}" if query else "")
    response = cms.get(path)
    assert response.status_code == 200, response.content
    return response.json()


def _guest_venue_codes(hotel) -> list[str]:
    with tenant_context(hotel.id):
        return list(
            Service.objects.filter(is_active=True, is_guest_facing=True)
            .order_by("sort_order", "code")
            .values_list("execution_point__code", flat=True)
        )


def test_preview_catalog_names_a_venue_of_this_hotel(cms, crystal):
    """Каталог показа принадлежит конкретному заведению, а не отелю вообще."""
    payload = _preview(cms, "catalog")

    venue = payload["venue"]
    assert venue is not None, "показ отдал каталог без заведения — экран не найдёт себя"
    assert venue["code"] in _guest_venue_codes(crystal)
    assert payload["categories"], "заведение показа осталось без позиций"


def test_preview_follows_the_hotel_when_the_first_venue_closes(cms, crystal):
    """
    Выбор пересчитывается по данным, а не запоминается константой.

    Первое гостевое заведение выключено — показ обязан взять следующее. Зашитый
    код прошёл бы этот тест только случайно: он не знает, что заведения не стало.
    """
    before = _preview(cms, "catalog")["venue"]["code"]
    codes = _guest_venue_codes(crystal)
    assert len(codes) > 1, "в сиде одно гостевое заведение — проверять нечего"

    with tenant_context(crystal.id):
        Service.objects.filter(execution_point__code=before).update(is_active=False)

    after = _preview(cms, "catalog")["venue"]["code"]
    assert after != before
    assert after in codes


def test_preview_without_guest_venues_says_so(cms, crystal):
    """Заведений нет вовсе — честный пустой ответ, а не каталог ниоткуда."""
    with tenant_context(crystal.id):
        Service.objects.filter(is_guest_facing=True).update(is_active=False)

    # Пусто целиком, а не «каталог отеля без заведения»: экрана, показывающего
    # меню всего отеля, у гостя не существует, и рисовать его оператору незачем.
    assert _preview(cms, "catalog") == {}


def test_preview_venue_differs_between_hotels(cms, cms_aurora, crystal, aurora):
    """
    У соседнего отеля свой код — ровно то, обо что разбивалась «кухня».

    Проверка про изоляцию только во вторую очередь: в первую — про то, что код
    берётся из данных отеля, и два отеля не обязаны называть заведения одинаково.
    """
    mine = _preview(cms, "catalog")["venue"]["code"]
    theirs = _preview(cms_aurora, "catalog")["venue"]["code"]

    assert mine in _guest_venue_codes(crystal)
    assert theirs in _guest_venue_codes(aurora)


def test_preview_honours_an_explicit_venue(cms, crystal):
    """Названное оператором заведение сервер не переназначает."""
    codes = _guest_venue_codes(crystal)
    chosen = codes[-1]

    payload = _preview(cms, "catalog", point=chosen)
    assert payload["venue"]["code"] == chosen


def test_guest_cannot_open_the_preview(client, crystal, guest_token):
    """Показ — ручка панели: гостевой токен к ней не подходит."""
    response = client.get(
        "/api/cms/brand/preview?screen=catalog",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401


def test_preview_locations_are_seen_by_a_guest_without_a_room(cms, crystal):
    """
    Локации показа — глазами гостя без номера.

    Отдельный укус, потому что ровно этот путь не трогал ни один тест: гостевые
    проверки ходят через сессию, а показ зовёт сборщик напрямую. Первая редакция
    выноса падала здесь с 500, и заметил это только полный прогон — по гостевым
    тестам, а не по этому месту.
    """
    payload = _preview(cms, "locations")

    assert payload["room"] is None, "показ назвал номер гостю, которого нет"
    kinds = {location["kind"] for location in payload["locations"]}
    assert "in_room" not in kinds, "«в номер» предложено без номера"
    assert payload["locations"], "локаций не осталось вовсе"
    assert all(location["is_default"] is False for location in payload["locations"])
