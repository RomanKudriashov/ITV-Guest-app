"""
ПОИСК ГОРОДОВ — ПОДСКАЗКИ DADATA (партия 65), для экрана погоды гостя.

ТОЛЬКО ГОРОДА. Подсказки адресов DaData ограничены уровнем «город»
(`from_bound`/`to_bound` = city): ни улиц, ни посёлков, ни районов. По всему
миру (`country_iso_code: *`) — гость в Сочи может смотреть погоду дома, в Дубае.

РАЙОНЫ-«ГОРОДА» ОТСЕКАЕМ. Зарубежная база отдаёт округа и районы как города:
на «Париж» приходят «Париж, 13-й округ» (или «Париж 15 Вожирар»), на «Dubai» —
«Bur Dubai» и «Downtown Dubai» с регионом «Dubai». Убираем подсказку, если её
название продолжает название другого города из выдачи («Париж» → «Париж, …»,
«Париж 15 …») или если её регион — другой город из той же выдачи.

ЯЗЫК — только ru и en: других у DaData нет; zh и ar получают английский.

КЛЮЧ НЕ ПОКИДАЕТ СЕРВЕР: витрина зовёт нашу ручку, а та — DaData. Ответы
кэшируются на сутки по (язык, запрос): набор по буквам не уходит к провайдеру
на каждое нажатие повторно.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5
CACHE_SECONDS = 24 * 60 * 60
CACHE_PREFIX = "dadata:cities:v2"  # v2 — после отсева округов (старые ответы не читать)
COUNT = 10


def available() -> bool:
    return bool(getattr(settings, "DADATA_API_KEY", ""))


def _language(language: str | None) -> str:
    return "ru" if (language or "").split("-")[0] == "ru" else "en"


def _row(suggestion: dict) -> dict | None:
    data = suggestion.get("data") or {}
    name = data.get("city") or data.get("settlement")
    try:
        latitude, longitude = float(data["geo_lat"]), float(data["geo_lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not name:
        return None
    return {
        "id": str(data.get("city_fias_id") or data.get("settlement_fias_id") or data.get("city_kladr_id") or f"{latitude},{longitude}"),
        "name": name,
        "region": data.get("region") if data.get("region") != name else "",
        "country": data.get("country") or "",
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
    }


def _drop_districts(rows: list[dict]) -> list[dict]:
    names = {row["name"] for row in rows}

    def district(row: dict) -> bool:
        name = row["name"]
        if any(other != name and (name.startswith(other + " ") or name.startswith(other + ",")) for other in names):
            return True
        return bool(row["region"]) and row["region"] in names and row["region"] != name

    return [row for row in rows if not district(row)]


def suggest_cities(query: str, language: str | None) -> list[dict] | None:
    """Города по началу названия. `None` — DaData не ответила (это не «не найдено»)."""
    query = (query or "").strip()
    if len(query) < 2 or not available():
        return []
    language = _language(language)
    key = f"{CACHE_PREFIX}:{language}:{query.casefold()}"
    hit = cache.get(key)
    if hit is not None:
        return hit

    import requests

    try:
        response = requests.post(
            getattr(settings, "DADATA_SUGGEST_URL", ""),
            json={
                "query": query,
                "count": COUNT,
                "from_bound": {"value": "city"},
                "to_bound": {"value": "city"},
                "locations": [{"country_iso_code": "*"}],
                "language": language,
            },
            headers={"Authorization": f"Token {settings.DADATA_API_KEY}", "Accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001 — сеть, DNS, таймаут: исход один
        logger.warning("DaData: недоступна", exc_info=True)
        return None
    if not response.ok:
        logger.warning("DaData: ответила %s", response.status_code)
        return None
    try:
        suggestions = (response.json() or {}).get("suggestions") or []
    except ValueError:
        return None
    rows = _drop_districts([row for row in (_row(item) for item in suggestions) if row])
    cache.set(key, rows, CACHE_SECONDS)
    return rows
