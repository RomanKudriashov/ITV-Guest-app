"""
Город вместо координат (пункт 22 заказчика).

Отель вписывал широту и долготу числами — и не вписал: на стенде координаты
были у одного отеля из двадцати девяти, а погода без них не включается.
Теперь оператор выбирает город, координаты и переводы приносит справочник.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.integrations.weather import service as weather
from apps.integrations.weather.base import CityMatch, CurrentWeather

pytestmark = pytest.mark.django_db

SOCHI = {
    "ru": CityMatch(491422, "Сочи", "Россия", "Краснодарский край", 43.59699, 39.72477, "Europe/Moscow"),
    "en": CityMatch(491422, "Sochi", "Russia", "Krasnodar Krai", 43.59699, 39.72477, "Europe/Moscow"),
    "ar": CityMatch(491422, "Sochi", "روسيا", "", 43.59699, 39.72477, "Europe/Moscow"),
    "zh": CityMatch(491422, "索契", "俄罗斯", "", 43.59699, 39.72477, "Europe/Moscow"),
}


class FakeProvider:
    """Справочник и погода без сети: у провайдера лимиты, у теста — своя правда."""

    def __init__(self, *, cities=True, forecast=True):
        self.cities = cities
        self.forecast = forecast

    def search_cities(self, query, language, count=10):
        if not self.cities:
            return None
        return [SOCHI.get(language, SOCHI["en"])] if query.lower().startswith(("соч", "soch")) else []

    def city(self, city_id, language):
        if not self.cities or int(city_id) != 491422:
            return None
        return SOCHI.get(language, SOCHI["en"])

    def current(self, latitude, longitude):
        if not self.forecast:
            return None
        from django.utils import timezone

        return CurrentWeather(temperature_c=18.4, code=0, is_day=True, observed_at=timezone.now())


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(weather, "get_provider", lambda: fake)
    from django.core.cache import cache

    cache.clear()
    return fake


def test_the_operator_searches_by_name(cms, provider):
    body = cms.get("/api/cms/weather/cities?q=Сочи&lang=ru").json()
    assert body["available"] is True
    assert body["cities"][0]["name"] == "Сочи"
    assert body["cities"][0]["country"] == "Россия"
    # Координаты в ответе есть — их кладёт в отель сервер, экран их не показывает.
    assert body["cities"][0]["latitude"] == pytest.approx(43.59699)


def test_two_letters_is_the_shortest_question(cms, provider):
    assert cms.get("/api/cms/weather/cities?q=С").json()["cities"] == []


def test_a_silent_directory_is_not_an_empty_answer(cms, monkeypatch):
    monkeypatch.setattr(weather, "get_provider", lambda: FakeProvider(cities=False))
    from django.core.cache import cache

    cache.clear()
    body = cms.get("/api/cms/weather/cities?q=Сочи").json()
    assert body == {"cities": [], "available": False}


def test_choosing_a_city_fills_coordinates_translations_and_zone(cms, crystal, provider):
    saved = cms.put(
        "/api/cms/home-settings",
        {"weather": True, "room_status": True, "city_id": 491422, "name": {"ru": "Кристалл"}},
    )
    assert saved.status_code == 200, saved.content
    body = saved.json()
    assert body["weather"] is True and body["weather_available"] is True
    assert body["city"]["ru"] == "Сочи" and body["city"]["en"] == "Sochi" and body["city"]["zh"] == "索契"
    assert body["timezone"] == "Europe/Moscow"
    with tenant_context(crystal):
        hotel = Hotel.objects.get(pk=crystal.pk)
        assert float(hotel.latitude) == pytest.approx(43.59699)
        assert float(hotel.longitude) == pytest.approx(39.72477)


def test_an_unknown_city_is_refused(cms, provider):
    response = cms.put(
        "/api/cms/home-settings", {"weather": False, "room_status": True, "city_id": 1}
    )
    assert response.status_code == 422 and response.json()["code"] == "city_not_found"


def test_the_preview_shows_the_weather_before_saving(cms, provider):
    body = cms.get("/api/cms/weather/preview?latitude=43.6&longitude=39.7").json()
    assert body == {"available": True, "units": "c", "temperature": 18, "code": 0, "is_day": True}


def test_the_preview_says_when_the_provider_is_silent(cms, monkeypatch):
    monkeypatch.setattr(weather, "get_provider", lambda: FakeProvider(forecast=False))
    assert cms.get("/api/cms/weather/preview?latitude=1&longitude=1").json() == {"available": False}


# --- Единицы -------------------------------------------------------------------


def test_units_are_a_hotel_setting_and_the_guest_sees_the_letter(client, cms, crystal, provider):
    from tests.chat.api.test_chat_reviews import guest_for

    cms.put(
        "/api/cms/home-settings",
        {"weather": True, "room_status": True, "city_id": 491422, "temperature_units": "f"},
    )
    assert cms.get("/api/cms/home-settings").json()["temperature_units"] == "f"

    # Кэш наполняет фоновая задача; здесь кладём наблюдение сами — проверяем
    # единицы, а не расписание обновлений.
    with tenant_context(crystal):
        weather.store(crystal.pk, provider.current(0, 0))

    guest = guest_for(client, crystal, room="212")
    home = guest.get("/api/guest/home").json()
    assert home["weather"]["units"] == "f"
    assert home["weather"]["temperature"] == 65, "18,4 °C — это 65 °F"

    cms.put(
        "/api/cms/home-settings",
        {"weather": True, "room_status": True, "temperature_units": "c"},
    )
    home = guest.get("/api/guest/home").json()
    assert home["weather"]["units"] == "c" and home["weather"]["temperature"] == 18


def test_a_wrong_unit_is_refused(cms, provider):
    response = cms.put(
        "/api/cms/home-settings", {"weather": False, "room_status": True, "temperature_units": "k"}
    )
    assert response.status_code == 422 and response.json()["code"] == "bad_units"
