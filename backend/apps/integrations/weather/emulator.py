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


def _forecast(latitude: float) -> dict:
    # Погода детерминирована от широты: проверки видят одно и то же число в
    # каждом прогоне, а города различимы между собой.
    temperature = round(30 - abs(latitude) * 0.4, 1)
    return {"current": {"temperature_2m": temperature, "weather_code": 1, "is_day": 1, "time": "2026-01-01T12:00"}}


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
            return self._send(200, _forecast(latitude))

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

    def log_message(self, *_args) -> None:  # тишина: запросов много, смысла в них нет
        return


def main() -> None:
    port = int(os.environ.get("WEATHER_EMULATOR_PORT", "1086"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
