"""
ПОДРОБНАЯ ПОГОДА (партия 65): разбор ответов Open-Meteo, кэш и ручка гостя.

Разбор проверяется на НАСТОЯЩИХ ответах для Сочи от 29.10.2026 (прогноз, сезонный
дневной ансамбль — урезан до 5 прогонов, сезонный месячный, море, воздух):
ответ «по документации» и живой ответ уже разошлись однажды — температура моря
в сезонных сводках приходит в кельвинах при подписи «°C».
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from django.core.cache import cache

from apps.integrations.weather import open_meteo_detail as om
from apps.integrations.weather import service

FIXTURE = json.loads((Path(__file__).parents[1] / "fixtures" / "open_meteo_sochi_2026_10_29.json").read_text())


def test_forecast_now_hours_and_sixteen_days():
    parsed = om.parse_forecast(FIXTURE["forecast"])
    now = parsed["current"]
    assert now["temperature_c"] is not None and now["code"] is not None
    for field in ("apparent_c", "humidity", "dew_point_c", "pressure_hpa", "wind_ms", "wind_dir", "gusts_ms", "cloud_cover", "visibility_m", "uv_index"):
        assert now[field] is not None, field
    assert len(parsed["hourly"]) == om.HOURS
    # Часы начинаются с ТЕКУЩЕГО часа, а не с полуночи.
    assert parsed["hourly"][0]["time"][:13] == now["time"][:13]
    assert len(parsed["daily"]) == 16
    day = parsed["daily"][0]
    assert day["sunrise"] and day["sunset"] and day["max_c"] >= day["min_c"]


def test_outlook_is_ensemble_mean_with_spread_and_starts_after_forecast():
    rows = om.parse_outlook(FIXTURE["seasonal_daily"], after="2026-11-13")
    assert rows and rows[0]["date"] > "2026-11-13"
    assert len(rows) == 46 - 16
    for row in rows:
        assert row["max_low_c"] <= row["max_c"] <= row["max_high_c"]
        assert 0 <= row["precipitation_probability"] <= 100


def test_bite_sea_temperature_in_kelvin_is_converted():
    months = om.parse_months(FIXTURE["seasonal_monthly"])
    assert len(months) == 6
    assert all(5 < month["sea_c"] < 35 for month in months), [m["sea_c"] for m in months]
    assert months[0]["sunshine_h"] > 0


def test_marine_and_air():
    marine = om.parse_marine(FIXTURE["marine"])
    assert marine["sea_c"] is not None and marine["wave_m"] is not None and len(marine["daily"]) == 8
    air = om.parse_air(FIXTURE["air"])
    assert air["european_aqi"] is not None and air["pm2_5"] is not None


def test_no_sea_means_no_marine_section_and_broken_parts_are_empty():
    assert om.parse_marine({"current": {"wave_height": None, "sea_surface_temperature": None}}) is None
    assert om.parse_air(None) is None
    assert om.parse_forecast(None) == {}
    assert om.parse_outlook({"daily": {"time": ["2026-01-01"]}}) == []


@pytest.mark.django_db
class TestDetailCache:
    @pytest.fixture(autouse=True)
    def _clean(self):
        cache.clear()
        yield
        cache.clear()

    @pytest.fixture
    def hotel(self, crystal):
        crystal.latitude, crystal.longitude = 43.6, 39.7
        crystal.settings = {**(crystal.settings or {}), "home": {"weather": True}}
        crystal.temperature_units = "c"
        crystal.save(update_fields=["latitude", "longitude", "settings", "temperature_units"])
        return crystal

    def test_cold_cache_is_pending_and_queues_one_refresh(self, hotel, monkeypatch):
        from apps.integrations.weather import tasks

        queued = []
        monkeypatch.setattr(tasks.refresh_hotel_weather_detail, "delay", lambda hotel_id: queued.append(hotel_id))
        assert service.detail_for(hotel) == (None, True)
        assert service.detail_for(hotel) == (None, True)
        assert queued == [str(hotel.pk)], "второй гость не ставит второе обновление"

    def test_units_follow_the_hotel(self, hotel, monkeypatch):
        from apps.integrations.weather import tasks

        monkeypatch.setattr(tasks.refresh_hotel_weather_detail, "delay", lambda hotel_id: None)
        service.store_detail(hotel.pk, {"current": {"temperature_c": 20.0}, "months": [{"temperature_c": 10.0, "anomaly_c": 1.0}]})
        detail, pending = service.detail_for(hotel)
        assert not pending and detail["current"]["temperature_c"] == 20.0 and detail["units"] == "c"
        hotel.temperature_units = "f"
        detail, _ = service.detail_for(hotel)
        assert detail["current"]["temperature_c"] == 68.0
        assert detail["months"][0]["anomaly_c"] == 1.8, "отклонение пересчитывается без сдвига 32°"

    def test_weather_off_is_not_pending(self, hotel):
        hotel.settings = {**hotel.settings, "home": {"weather": False}}
        assert service.detail_for(hotel) == (None, False)
