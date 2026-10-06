"""
Значок заведения у гостя (п.68): витрина отдаёт ТИП заведения.

Без фото гость видит иконку по типу на цвете бренда; для этого плитке
заведения, карточке списка и строке поиска нужен `service_type` — `kind`
точки исполнения его не знает (у рум-сервиса и ресторана он одинаково
«кухня»). Строке поиска 56×56 — вариант обложки `thumb`, а не `card`.
"""

from __future__ import annotations

import pytest

from tests.chat.api.test_chat_reviews import guest_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def guest(client, crystal):
    return guest_for(client, crystal, room="212")


def test_home_tiles_and_venue_cards_carry_the_venue_type(guest):
    tiles = guest.get("/api/guest/home").json()["tiles"]
    spa = next(t for t in tiles if t["type"] == "venue" and t["key"] == "spa")
    assert spa["service_type"] == "spa"
    venues = guest.get("/api/guest/venues?group=restaurants").json()["venues"]
    kitchen = next(v for v in venues if v["code"] == "kitchen")
    assert kitchen["service_type"] == "restaurant"


def test_search_rows_of_venues_carry_the_type_and_a_light_cover(guest):
    rows = guest.get("/api/guest/search?q=Спа").json()
    found = [row for group in rows.values() if isinstance(group, list) for row in group if row.get("kind") == "service"]
    assert found, rows
    assert all(row["service_type"] for row in found)
    assert all(not row["image"] or "/thumb/" in row["image"] for row in found)
