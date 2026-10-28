"""
ПОГОДА «В ПУТИ» (партия 65).

Данные погоды живут 45 минут, а фонового обновления по расписанию нет: отель,
который долго никто не открывал, встречал первого гостя главной БЕЗ погоды —
обновление только ставилось в очередь, и блок появлялся после перезагрузки.
Теперь главная говорит «погода включена, но ещё едет», и витрина переспрашивает.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache

from apps.catalog.services.home import home_payload
from apps.integrations.weather import service

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def queued(monkeypatch):
    """Задача обновления ушла в очередь и ещё не исполнилась — как в проде."""
    calls = []
    from apps.integrations.weather import tasks

    monkeypatch.setattr(tasks.refresh_hotel_weather, "delay", lambda hotel_id: calls.append(hotel_id))
    return calls


def _hotel(crystal, *, weather: bool):
    crystal.latitude, crystal.longitude = 43.585, 39.723
    crystal.settings = {**(crystal.settings or {}), "home": {"weather": weather}}
    crystal.save(update_fields=["latitude", "longitude", "settings"])
    return crystal


def _home(hotel):
    return home_payload(hotel, language="ru", room=None, unread_chat=0)


def test_bite_cold_cache_says_weather_is_on_its_way(crystal, queued):
    body = _home(_hotel(crystal, weather=True))
    assert body["weather"] is None
    assert body["weather_pending"] is True
    assert queued, "обновление должно уйти в очередь"


def test_weather_off_is_not_pending(crystal, queued):
    body = _home(_hotel(crystal, weather=False))
    assert body["weather"] is None
    assert body["weather_pending"] is False


def test_fresh_weather_is_not_pending(crystal, queued):
    hotel = _hotel(crystal, weather=True)
    from datetime import datetime, timezone

    from apps.integrations.weather.base import CurrentWeather

    service.store(hotel.pk, CurrentWeather(temperature_c=20.0, code=3, is_day=True, observed_at=datetime.now(tz=timezone.utc)))
    body = _home(hotel)
    assert body["weather"]["temperature"] == 20
    assert body["weather_pending"] is False
