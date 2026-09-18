"""
Провайдер погоды Open-Meteo.

БЕЗ КЛЮЧА И БЕЗ РЕГИСТРАЦИИ — обычный GET, JSON. Именно поэтому он выбран
провайдером по умолчанию: стенд и демо работают сразу, без секретов в
окружении и без чужого аккаунта.

ЛИЦЕНЗИЯ — НЕ ДЕТАЛЬ. Публичный api.open-meteo.com бесплатен только для
некоммерческого использования и до 10 000 запросов в сутки. Наш продукт
коммерческий, поэтому для боевой эксплуатации нужен либо платный план
провайдера, либо СВОЙ экземпляр (сервер открытый, ставится в Docker) — адрес
задаётся настройкой `WEATHER_API_URL`, кода это не касается. Подробности и
порядок действий — docs/ops/weather.md.

АТРИБУЦИЯ обязательна и живёт на витрине рядом с погодой ссылкой на
open-meteo.com. Убрать её нельзя — это условие лицензии, а не украшение.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from .base import CityMatch, CurrentWeather

logger = logging.getLogger(__name__)

# Дольше ждать нечего: погода — украшение главной, а не её содержание. Не
# успел ответить — блока просто не будет, и гость этого не заметит.
TIMEOUT_SECONDS = 6


class OpenMeteoProvider:
    """Текущая погода одним запросом к `/v1/forecast`."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def search_cities(self, query: str, language: str, count: int = 10) -> list[CityMatch] | None:
        """Справочник живёт своим адресом — у Open-Meteo это отдельный хост."""
        return self._geocoding().search(query, language, count)

    def city(self, city_id: int, language: str) -> CityMatch | None:
        return self._geocoding().get(city_id, language)

    def _geocoding(self) -> "_Geocoding":
        from django.conf import settings

        return _Geocoding(getattr(settings, "WEATHER_GEOCODER_URL", "https://geocoding-api.open-meteo.com"))

    def current(self, latitude: float, longitude: float) -> CurrentWeather | None:
        import requests

        try:
            response = requests.get(
                f"{self.base_url}/v1/forecast",
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": "temperature_2m,weather_code,is_day",
                    "timezone": "UTC",
                },
                timeout=TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 — сеть, DNS, таймаут: причина не меняет исход
            logger.warning("Погода: провайдер недоступен", exc_info=True)
            return None

        if not response.ok:
            logger.warning("Погода: провайдер ответил %s", response.status_code)
            return None

        try:
            current = (response.json() or {}).get("current") or {}
            temperature = current["temperature_2m"]
            code = current["weather_code"]
        except Exception:  # noqa: BLE001 — ответ не той формы равен отсутствию ответа
            logger.warning("Погода: ответ провайдера не разобран", exc_info=True)
            return None

        if temperature is None or code is None:
            return None

        return CurrentWeather(
            temperature_c=float(temperature),
            code=int(code),
            # `is_day` появился в ответе не сразу и у своего экземпляра может
            # быть выключен: нет признака — считаем день, иконка ошибётся
            # мягче, чем блок исчезнет.
            is_day=bool(current.get("is_day", 1)),
            observed_at=datetime.now(tz=timezone.utc),
        )


class _Geocoding:
    """
    Справочник городов Open-Meteo (`/v1/search`, данные GeoNames).

    ЗАЧЕМ ОН ВООБЩЕ. Отель заполнял широту и долготу числами — и не заполнил:
    на стенде координаты есть у одного отеля из двадцати девяти, а погода без
    них не включается вовсе. Оператор знает не координаты, а город.

    ЛИЦЕНЗИЯ ТА ЖЕ, что у погоды: публичный доступ бесплатен только для
    некоммерческого использования, атрибуция (CC BY 4.0 + GeoNames)
    обязательна на любом плане. Нового вопроса это не заводит — он тот же
    самый, см. `docs/ops/weather.md`.
    """

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def get(self, city_id: int, language: str) -> CityMatch | None:
        import requests

        try:
            response = requests.get(
                f"{self.base_url}/v1/get",
                params={"id": int(city_id), "language": language or "en"},
                timeout=TIMEOUT_SECONDS,
            )
            if not response.ok:
                return None
            row = response.json() or {}
            return CityMatch(
                id=int(row["id"]),
                name=str(row["name"]),
                country=str(row.get("country") or row.get("country_code") or ""),
                admin=str(row.get("admin1") or ""),
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                timezone=str(row.get("timezone") or "UTC"),
            )
        except Exception:  # noqa: BLE001 — сеть или ответ не той формы: города нет
            logger.warning("Города: запись %s не получена", city_id, exc_info=True)
            return None

    def search(self, query: str, language: str, count: int = 10) -> list[CityMatch]:
        import requests

        query = (query or "").strip()
        if len(query) < 2:
            # У провайдера минимум две буквы; спрашивать по одной — зря ходить.
            return []
        try:
            response = requests.get(
                f"{self.base_url}/v1/search",
                params={"name": query, "count": count, "language": language or "en", "format": "json"},
                timeout=TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 — сеть, DNS, таймаут: причина не меняет исход
            logger.warning("Города: справочник недоступен", exc_info=True)
            return None
        if not response.ok:
            logger.warning("Города: справочник ответил %s", response.status_code)
            return None
        try:
            rows = (response.json() or {}).get("results") or []
        except Exception:  # noqa: BLE001
            logger.warning("Города: ответ справочника не разобран", exc_info=True)
            return None

        matches = []
        for row in rows:
            try:
                matches.append(
                    CityMatch(
                        id=int(row["id"]),
                        name=str(row["name"]),
                        country=str(row.get("country") or ""),
                        admin=str(row.get("admin1") or ""),
                        latitude=float(row["latitude"]),
                        longitude=float(row["longitude"]),
                        timezone=str(row.get("timezone") or "UTC"),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return matches
