"""
ЭМУЛЯТОР OPEN-METEO ДЛЯ РАЗРАБОТКИ И E2E (партия 25).

Зачем. Погода и справочник городов ходили из контейнера бэкенда в настоящий
api.open-meteo.com. У docker-сети этой машины TLS-рукопожатие с ним рвётся
через раз (`SSLEOFError: UNEXPECTED_EOF_WHILE_READING` в логе бэкенда) — и
e2e `weather-city` краснела в полном прогоне два раза подряд, поодиночке
зеленея: ей везло. Проверка выбора города зависела от внешней сети, а не от
нашего кода.

Что это. Тот же HTTP, что у Open-Meteo, — `/v1/forecast`, `/v1/search`,
`/v1/get` — с ответами той же формы, на маленьком наборе городов. Провайдер
приложения ходит сюда настоящим `requests` и разбирает настоящий JSON: путь
кода тот же, меняется только адрес (`WEATHER_API_URL`,
`WEATHER_GEOCODER_URL` в docker-compose для разработки). Стенд и бой —
по-прежнему настоящий Open-Meteo (`.env.prod`).

Чистый stdlib, как эмулятор iRidi: Django не импортируется.

Запуск: python -m apps.integrations.weather.emulator  (порт WEATHER_EMULATOR_PORT, 1086)
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# Идентификаторы — настоящие GeoNames: данные, заведённые в разработке, не
# расходятся с тем, что вернул бы настоящий справочник.
CITIES = [
    {
        "id": 524901,
        "names": {"ru": "Москва", "en": "Moscow", "ar": "موسكو", "zh": "莫斯科"},
        "country": {"ru": "Россия", "en": "Russia", "ar": "روسيا", "zh": "俄罗斯"},
        "admin1": {"ru": "Москва", "en": "Moscow", "ar": "موسكو", "zh": "莫斯科"},
        "latitude": 55.75222,
        "longitude": 37.61556,
        "timezone": "Europe/Moscow",
    },
    {
        "id": 491422,
        "names": {"ru": "Сочи", "en": "Sochi", "ar": "سوتشي", "zh": "索契"},
        "country": {"ru": "Россия", "en": "Russia", "ar": "روسيا", "zh": "俄罗斯"},
        "admin1": {"ru": "Краснодарский край", "en": "Krasnodar Krai", "ar": "كراسنودار", "zh": "克拉斯诺达尔边疆区"},
        "latitude": 43.59917,
        "longitude": 39.72569,
        "timezone": "Europe/Moscow",
    },
    {
        "id": 498817,
        "names": {"ru": "Санкт-Петербург", "en": "Saint Petersburg", "ar": "سانت بطرسبرغ", "zh": "圣彼得堡"},
        "country": {"ru": "Россия", "en": "Russia", "ar": "روسيا", "zh": "俄罗斯"},
        "admin1": {"ru": "Санкт-Петербург", "en": "Saint Petersburg", "ar": "سانت بطرسبرغ", "zh": "圣彼得堡"},
        "latitude": 59.93863,
        "longitude": 30.31413,
        "timezone": "Europe/Moscow",
    },
    {
        "id": 292223,
        "names": {"ru": "Дубай", "en": "Dubai", "ar": "دبي", "zh": "迪拜"},
        "country": {"ru": "ОАЭ", "en": "United Arab Emirates", "ar": "الإمارات", "zh": "阿联酋"},
        "admin1": {"ru": "Дубай", "en": "Dubai", "ar": "دبي", "zh": "迪拜"},
        "latitude": 25.07725,
        "longitude": 55.30927,
        "timezone": "Asia/Dubai",
    },
]


def _row(city: dict, language: str) -> dict:
    pick = lambda field: city[field].get(language) or city[field]["en"]  # noqa: E731
    return {
        "id": city["id"],
        "name": pick("names"),
        "country": pick("country"),
        "admin1": pick("admin1"),
        "latitude": city["latitude"],
        "longitude": city["longitude"],
        "timezone": city["timezone"],
    }


def _forecast(latitude: float, query: dict | None = None) -> dict:
    # Погода детерминирована от широты: проверки видят одно и то же число в
    # каждом прогоне, а города различимы между собой.
    temperature = round(30 - abs(latitude) * 0.4, 1)
    body: dict = {"current": {"temperature_2m": temperature, "weather_code": 1, "is_day": 1, "time": "2026-01-01T12:00"}}
    query = query or {}
    # ПОДРОБНАЯ ПОГОДА (партия 65): те поля, что просит экран погоды, той же
    # формы, что у Open-Meteo. Значения — простые детерминированные ряды.
    if "relative_humidity_2m" in query.get("current", ""):
        body["current"].update({
            "relative_humidity_2m": 60, "apparent_temperature": temperature + 0.5, "precipitation": 0.0,
            "cloud_cover": 30, "pressure_msl": 1015.0, "wind_speed_10m": 3.0, "wind_direction_10m": 200,
            "wind_gusts_10m": 6.0, "uv_index": 3.0, "visibility": 30000.0, "dew_point_2m": temperature - 8,
        })
    if query.get("hourly"):
        hours = [f"2026-01-{1 + h // 24:02d}T{h % 24:02d}:00" for h in range(72)]
        body["hourly"] = {
            "time": hours,
            "temperature_2m": [round(temperature - 4 + 4 * ((h % 24) in range(10, 18)), 1) for h in range(72)],
            "weather_code": [1 if h % 24 < 18 else 3 for h in range(72)],
            "is_day": [1 if 7 <= h % 24 < 19 else 0 for h in range(72)],
            "precipitation_probability": [(h * 7) % 60 for h in range(72)],
            "precipitation": [0.0] * 72,
            "wind_speed_10m": [3.0] * 72,
        }
    if query.get("daily"):
        days = int(query.get("forecast_days", 7))
        dates = [f"2026-01-{1 + d:02d}" for d in range(days)]
        body["daily"] = {
            "time": dates,
            "weather_code": [(0, 2, 3, 61, 80)[d % 5] for d in range(days)],
            "temperature_2m_max": [round(temperature + (d % 4), 1) for d in range(days)],
            "temperature_2m_min": [round(temperature - 6 + (d % 3), 1) for d in range(days)],
            "apparent_temperature_max": [round(temperature + (d % 4) + 1, 1) for d in range(days)],
            "apparent_temperature_min": [round(temperature - 7 + (d % 3), 1) for d in range(days)],
            "sunrise": [f"{x}T07:30" for x in dates],
            "sunset": [f"{x}T17:10" for x in dates],
            "daylight_duration": [34800.0] * days,
            "sunshine_duration": [25200.0] * days,
            "uv_index_max": [3.5] * days,
            "precipitation_sum": [(0.0, 0.0, 1.2, 6.5, 3.0)[d % 5] for d in range(days)],
            "precipitation_hours": [(0, 0, 2, 6, 3)[d % 5] for d in range(days)],
            "precipitation_probability_max": [(5, 10, 40, 80, 60)[d % 5] for d in range(days)],
            "wind_speed_10m_max": [5.0] * days,
            "wind_gusts_10m_max": [9.0] * days,
            "wind_direction_10m_dominant": [200] * days,
        }
    return body


def _seasonal(latitude: float, query: dict) -> dict:
    base = round(30 - abs(latitude) * 0.4, 1)
    if query.get("monthly"):
        months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"]
        return {"monthly": {
            "time": months,
            "temperature_2m_mean": [round(base - 4 + 2 * m, 1) for m in range(6)],
            "temperature_2m_anomaly": [0.5, -0.3, 1.1, 0.0, 0.8, 1.4],
            "precipitation_mean": [120.0, 90.0, 80.0, 70.0, 60.0, 50.0],
            "precipitation_anomaly": [10.0, -5.0, 0.0, 4.0, -12.0, 3.0],
            # В кельвинах — как у настоящего сервиса (см. open_meteo_detail).
            "sea_surface_temperature_mean": [round(273.15 + 12 + m, 1) for m in range(6)],
            "sunshine_duration_mean": [360000.0, 432000.0, 540000.0, 648000.0, 756000.0, 864000.0],
        }}
    days = int(query.get("forecast_days", 46))
    daily: dict = {"time": [f"2026-{1 + d // 28:02d}-{1 + d % 28:02d}" for d in range(days)]}
    for name, shift in (("temperature_2m_max", 2), ("temperature_2m_min", -5), ("precipitation_sum", 0), ("sea_surface_temperature_mean", 0)):
        def value(d, member):
            if name == "precipitation_sum":
                return float((d + member) % 4)
            if name == "sea_surface_temperature_mean":
                return round(14.0 + 0.01 * member, 2)
            return round(base + shift + (member % 5) - 2 + (d % 3), 1)
        daily[name] = [value(d, 0) for d in range(days)]
        for member in range(1, 11):
            daily[f"{name}_member{member:02d}"] = [value(d, member) for d in range(days)]
    return {"daily": daily}


def _marine(latitude: float) -> dict:
    return {
        "current": {"wave_height": 0.6, "wave_direction": 180, "wave_period": 5.0, "sea_surface_temperature": 14.5},
        "daily": {"time": [f"2026-01-{1 + d:02d}" for d in range(8)], "wave_height_max": [0.6 + 0.1 * d for d in range(8)],
                  "wave_direction_dominant": [180] * 8, "wave_period_max": [6.0] * 8},
    }


def _air() -> dict:
    return {"current": {"european_aqi": 35, "us_aqi": 48, "pm10": 18.0, "pm2_5": 9.0, "ozone": 60.0,
                        "nitrogen_dioxide": 12.0, "sulphur_dioxide": 2.0, "carbon_monoxide": 180.0, "dust": 1.0,
                        "uv_index": 3.0, "alder_pollen": None, "birch_pollen": None, "grass_pollen": None,
                        "mugwort_pollen": None, "olive_pollen": None, "ragweed_pollen": None}}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — имя задаёт http.server
        url = urlparse(self.path)
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        language = query.get("language", "en")

        if url.path == "/v1/forecast":
            try:
                latitude = float(query["latitude"])
            except (KeyError, ValueError):
                return self._send(400, {"error": True, "reason": "latitude required"})
            return self._send(200, _forecast(latitude, query))

        if url.path in ("/v1/seasonal", "/v1/marine", "/v1/air-quality"):
            try:
                latitude = float(query["latitude"])
            except (KeyError, ValueError):
                return self._send(400, {"error": True, "reason": "latitude required"})
            if url.path == "/v1/seasonal":
                return self._send(200, _seasonal(latitude, query))
            return self._send(200, _marine(latitude) if url.path == "/v1/marine" else _air())

        if url.path == "/v1/search":
            needle = query.get("name", "").strip().lower()
            if len(needle) < 2:
                return self._send(200, {})
            found = [
                _row(city, language)
                for city in CITIES
                if any(name.lower().startswith(needle) for name in city["names"].values())
            ]
            return self._send(200, {"results": found} if found else {})

        if url.path == "/v1/get":
            try:
                wanted = int(query["id"])
            except (KeyError, ValueError):
                return self._send(400, {"error": True, "reason": "id required"})
            for city in CITIES:
                if city["id"] == wanted:
                    return self._send(200, _row(city, language))
            return self._send(404, {"error": True, "reason": "not found"})

        return self._send(404, {"error": True, "reason": "unknown path"})

    def do_POST(self) -> None:  # noqa: N802
        # ПОДСКАЗКИ DADATA (партия 65): поиск города на экране погоды. Та же
        # форма ответа, что у suggestions.dadata.ru, на тех же городах.
        url = urlparse(self.path)
        if url.path != "/suggestions/api/4_1/rs/suggest/address":
            return self._send(404, {"error": True, "reason": "unknown path"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._send(400, {"error": True})
        needle = str(body.get("query", "")).strip().lower()
        language = "ru" if body.get("language", "ru") == "ru" else "en"
        found = []
        for city in CITIES:
            if needle and any(name.lower().startswith(needle) for name in city["names"].values()):
                name, country, region = city["names"][language], city["country"][language], city["admin1"][language]
                found.append({
                    "value": f"{country}, {region}, {name}",
                    "data": {"city": name, "region": region, "country": country, "city_fias_id": str(city["id"]),
                             "geo_lat": str(city["latitude"]), "geo_lon": str(city["longitude"])},
                })
        return self._send(200, {"suggestions": found})

    def log_message(self, *_args) -> None:  # тишина: запросов много, смысла в них нет
        return


def main() -> None:
    port = int(os.environ.get("WEATHER_EMULATOR_PORT", "1086"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
