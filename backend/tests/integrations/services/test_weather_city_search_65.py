"""
ПОИСК ГОРОДА НА ЭКРАНЕ ПОГОДЫ (партия 65): подсказки DaData и погода по точке.

Ответы DaData — той формы, что пришла от живого сервиса 29.10.2026 на «Париж»:
вместе с городом приходят его округа («Париж 15 Вожирар»), их отсекаем.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache

from apps.integrations.geo import dadata
from apps.integrations.weather import service


def _suggestion(name, region, country, lat, lon, fias="x"):
    return {"value": f"{country}, {region}, г {name}", "data": {"city": name, "region": region, "country": country, "city_fias_id": fias, "geo_lat": str(lat), "geo_lon": str(lon)}}


class _Response:
    def __init__(self, body, ok=True, status=200):
        self._body, self.ok, self.status_code = body, ok, status

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _clean(settings):
    cache.clear()
    settings.DADATA_API_KEY = "test-key"
    settings.DADATA_SUGGEST_URL = "http://dadata.test/suggest"
    yield
    cache.clear()


def test_bite_districts_are_dropped_and_only_cities_are_asked(monkeypatch):
    import requests

    sent = {}

    def post(url, json, headers, timeout):
        sent.update(json)
        return _Response({"suggestions": [
            _suggestion("Париж", "Иль-де-Франс", "Франция", 48.85341, 2.3488, "1"),
            _suggestion("Париж 15 Вожирар", "Иль-де-Франс", "Франция", 48.8412, 2.3003, "2"),
            _suggestion("Париж, 13-й округ", "Иль-де-Франс", "Франция", 48.8322, 2.3561, "3"),
            {"value": "без координат", "data": {"city": "Нигде"}},
        ]})

    monkeypatch.setattr(requests, "post", post)
    rows = dadata.suggest_cities("Париж", "ru")
    assert [row["name"] for row in rows] == ["Париж"]
    assert sent["from_bound"] == {"value": "city"} and sent["to_bound"] == {"value": "city"}
    assert sent["locations"] == [{"country_iso_code": "*"}]


def test_language_is_ru_or_en_and_answers_are_cached(monkeypatch):
    import requests

    calls = []
    monkeypatch.setattr(requests, "post", lambda url, json, headers, timeout: calls.append(json["language"]) or _Response({"suggestions": [_suggestion("Dubai", "Dubai", "UAE", 25.08, 55.31)]}))
    dadata.suggest_cities("Dub", "zh")
    dadata.suggest_cities("dub", "zh")
    assert calls == ["en"], "zh — английский DaData; второй набор — из кэша"


def test_provider_down_is_none_not_empty(monkeypatch):
    import requests

    monkeypatch.setattr(requests, "post", lambda *a, **k: _Response({}, ok=False, status=503))
    assert dadata.suggest_cities("Сочи", "ru") is None


def test_no_key_no_search(settings):
    settings.DADATA_API_KEY = ""
    assert not dadata.available()
    assert dadata.suggest_cities("Сочи", "ru") == []


def test_point_is_rounded_and_validated():
    assert service.point_of("55.75396", "37.620393") == (55.75, 37.62)
    assert service.point_of(91, 0) is None
    assert service.point_of("x", 1) is None


@pytest.mark.django_db
def test_point_weather_pending_then_units(monkeypatch):
    from apps.integrations.weather import tasks

    queued = []
    monkeypatch.setattr(tasks.refresh_point_weather_detail, "delay", lambda lat, lon: queued.append((lat, lon)))
    point = (25.08, 55.31)
    assert service.detail_for_point(point, "c") == (None, True)
    assert service.detail_for_point(point, "c") == (None, True)
    assert queued == [point], "второй гость не ставит второе обновление той же точки"
    service.store_point_detail(point, {"current": {"temperature_c": 30.0}})
    detail, pending = service.detail_for_point(point, "f")
    assert not pending and detail["current"]["temperature_c"] == 86.0 and detail["units"] == "f"


def test_districts_of_a_city_by_region_are_dropped(monkeypatch):
    """Живая выдача на «Dubai»: районы с регионом «Dubai» — не города."""
    import requests

    monkeypatch.setattr(requests, "post", lambda *a, **k: _Response({"suggestions": [
        _suggestion("Dubai", "Dubai", "United Arab Emirates", 25.07, 55.30, "1"),
        _suggestion("Bur Dubai", "Dubai", "United Arab Emirates", 25.25, 55.30, "2"),
        _suggestion("Downtown Dubai", "Dubai", "United Arab Emirates", 25.19, 55.27, "3"),
        _suggestion("Sochi", "Krasnodar", "Russia", 43.58, 39.72, "4"),
    ]}))
    assert [row["name"] for row in dadata.suggest_cities("Dub", "en")] == ["Dubai", "Sochi"]
