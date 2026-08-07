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

from .base import CurrentWeather

logger = logging.getLogger(__name__)

# Дольше ждать нечего: погода — украшение главной, а не её содержание. Не
# успел ответить — блока просто не будет, и гость этого не заметит.
TIMEOUT_SECONDS = 6


class OpenMeteoProvider:
    """Текущая погода одним запросом к `/v1/forecast`."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

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
