"""
ПОДРОБНАЯ ПОГОДА ОТ OPEN-METEO (партия 65): всё, что провайдер умеет для точки.

У Open-Meteo это ПЯТЬ запросов к четырём сервисам, и у каждого своя глубина:

- `/v1/forecast` — сейчас, по часам и по дням, до 16 дней (больше не отдаёт);
- `/v1/seasonal`, дневной — ансамбль из 51 прогона на 46 дней. Базовый ряд —
  это ОДИН прогон и потому шумный; берём среднее по всем и разброс 10–90 %:
  на третью неделю честно сказать «около 12°, от 9 до 16» можно, «11,3°» — нет;
- `/v1/seasonal`, месячный — средние и отклонение от нормы на полгода;
- `/v1/marine` — вода и волна, до 8 дней. Не у моря — значения пустые, и
  раздела нет вовсе;
- `/v1/air-quality` — индекс качества воздуха и частицы; пыльца только в Европе.

Любой из них может не ответить — тогда пропадает ТОЛЬКО его раздел: экран без
волн лучше, чем экран без погоды.

ЕДИНИЦЫ ОТСЮДА ВЫХОДЯТ ОДНИ: Цельсий, м/с, гПа, мм, метры, секунды. Пересчёт в
единицы отеля и подписи — дело сервиса и витрины. Ветер просим сразу в м/с.

ЗАМЕЧЕНО НА ЖИВОМ API: в недельных и месячных сводках сезонного прогноза
температура моря приходит в КЕЛЬВИНАХ, хотя единица подписана «°C» (294,2).
Значения больше 150 переводим из кельвинов.
"""

from __future__ import annotations

import logging
import statistics
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 8
FORECAST_DAYS = 16
OUTLOOK_DAYS = 46
HOURS = 48

CURRENT = (
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,"
    "weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,"
    "wind_gusts_10m,uv_index,visibility,dew_point_2m"
)
HOURLY = "temperature_2m,weather_code,is_day,precipitation_probability,precipitation,wind_speed_10m"
DAILY = (
    "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,"
    "apparent_temperature_min,sunrise,sunset,daylight_duration,sunshine_duration,"
    "uv_index_max,precipitation_sum,precipitation_hours,precipitation_probability_max,"
    "wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant"
)
SEASONAL_DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum,sea_surface_temperature_mean"
SEASONAL_MONTHLY = (
    "temperature_2m_mean,temperature_2m_anomaly,precipitation_mean,precipitation_anomaly,"
    "sea_surface_temperature_mean,sunshine_duration_mean"
)
MARINE_CURRENT = "wave_height,wave_direction,wave_period,sea_surface_temperature"
MARINE_DAILY = "wave_height_max,wave_direction_dominant,wave_period_max"
AIR_CURRENT = (
    "european_aqi,us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,"
    "dust,uv_index,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen"
)
POLLEN = ("alder", "birch", "grass", "mugwort", "olive", "ragweed")


def _get(url: str, params: dict) -> dict | None:
    import requests

    try:
        response = requests.get(url, params=params, timeout=TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001 — сеть, DNS, таймаут: исход один
        logger.warning("Погода: %s недоступен", url, exc_info=True)
        return None
    if not response.ok:
        logger.warning("Погода: %s ответил %s", url, response.status_code)
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict) or body.get("error"):
        logger.warning("Погода: %s отказал: %s", url, (body or {}).get("reason") if isinstance(body, dict) else "")
        return None
    return body


def _num(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value) -> int | None:
    number = _num(value)
    return None if number is None else int(round(number))


def _celsius(value) -> float | None:
    """Температура моря сезонного прогноза бывает в кельвинах — см. шапку."""
    number = _num(value)
    if number is None:
        return None
    return round(number - 273.15, 1) if number > 150 else round(number, 1)


def _column(block: dict, name: str, index: int):
    values = block.get(name)
    if not isinstance(values, list) or index >= len(values):
        return None
    return values[index]


def parse_forecast(body: dict | None, *, now_local: str | None = None) -> dict:
    """`/v1/forecast` → current, hourly (48 ч от текущего часа), daily (16 дней)."""
    if not body:
        return {}
    out: dict = {}
    current = body.get("current") or {}
    if current.get("temperature_2m") is not None and current.get("weather_code") is not None:
        out["current"] = {
            "time": current.get("time"),
            "temperature_c": _num(current.get("temperature_2m")),
            "apparent_c": _num(current.get("apparent_temperature")),
            "humidity": _int(current.get("relative_humidity_2m")),
            "dew_point_c": _num(current.get("dew_point_2m")),
            "pressure_hpa": _num(current.get("pressure_msl")),
            "wind_ms": _num(current.get("wind_speed_10m")),
            "wind_dir": _int(current.get("wind_direction_10m")),
            "gusts_ms": _num(current.get("wind_gusts_10m")),
            "cloud_cover": _int(current.get("cloud_cover")),
            "visibility_m": _num(current.get("visibility")),
            "uv_index": _num(current.get("uv_index")),
            "precipitation_mm": _num(current.get("precipitation")),
            "code": _int(current.get("weather_code")),
            "is_day": bool(current.get("is_day", 1)),
        }

    hourly = body.get("hourly") or {}
    times = hourly.get("time") or []
    start = 0
    anchor = now_local or (current.get("time") or "")[:13]
    if anchor:
        for index, stamp in enumerate(times):
            if str(stamp)[:13] >= anchor[:13]:
                start = index
                break
    out["hourly"] = [
        {
            "time": times[i],
            "temperature_c": _num(_column(hourly, "temperature_2m", i)),
            "code": _int(_column(hourly, "weather_code", i)),
            "is_day": bool(_column(hourly, "is_day", i) if _column(hourly, "is_day", i) is not None else 1),
            "precipitation_probability": _int(_column(hourly, "precipitation_probability", i)),
            "precipitation_mm": _num(_column(hourly, "precipitation", i)),
            "wind_ms": _num(_column(hourly, "wind_speed_10m", i)),
        }
        for i in range(start, min(len(times), start + HOURS))
        if _column(hourly, "temperature_2m", i) is not None
    ]

    daily = body.get("daily") or {}
    out["daily"] = [
        {
            "date": day,
            "code": _int(_column(daily, "weather_code", i)),
            "max_c": _num(_column(daily, "temperature_2m_max", i)),
            "min_c": _num(_column(daily, "temperature_2m_min", i)),
            "apparent_max_c": _num(_column(daily, "apparent_temperature_max", i)),
            "apparent_min_c": _num(_column(daily, "apparent_temperature_min", i)),
            "sunrise": _column(daily, "sunrise", i),
            "sunset": _column(daily, "sunset", i),
            "daylight_s": _num(_column(daily, "daylight_duration", i)),
            "sunshine_s": _num(_column(daily, "sunshine_duration", i)),
            "uv_max": _num(_column(daily, "uv_index_max", i)),
            "precipitation_mm": _num(_column(daily, "precipitation_sum", i)),
            "precipitation_hours": _num(_column(daily, "precipitation_hours", i)),
            "precipitation_probability": _int(_column(daily, "precipitation_probability_max", i)),
            "wind_max_ms": _num(_column(daily, "wind_speed_10m_max", i)),
            "gusts_max_ms": _num(_column(daily, "wind_gusts_10m_max", i)),
            "wind_dir": _int(_column(daily, "wind_direction_10m_dominant", i)),
        }
        for i, day in enumerate(daily.get("time") or [])
        if _column(daily, "temperature_2m_max", i) is not None
    ]
    return out


def _ensemble(block: dict, name: str, index: int) -> list[float]:
    values = []
    for key, column in block.items():
        if key == name or key.startswith(f"{name}_member"):
            if isinstance(column, list) and index < len(column):
                number = _num(column[index])
                if number is not None:
                    values.append(number)
    return values


def _percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * share
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def parse_outlook(body: dict | None, *, after: str | None = None) -> list[dict]:
    """
    Сезонный дневной ансамбль → ориентир по дням: среднее по прогонам и
    разброс 10–90 %. Дни, уже покрытые обычным прогнозом (`after`), пропускаем.
    """
    if not body:
        return []
    daily = body.get("daily") or {}
    rows = []
    for i, day in enumerate(daily.get("time") or []):
        if after and str(day) <= after:
            continue
        highs = _ensemble(daily, "temperature_2m_max", i)
        lows = _ensemble(daily, "temperature_2m_min", i)
        if not highs or not lows:
            continue
        rain = _ensemble(daily, "precipitation_sum", i)
        sea = [value for value in (_celsius(v) for v in _ensemble(daily, "sea_surface_temperature_mean", i)) if value is not None]
        rows.append(
            {
                "date": day,
                "max_c": round(statistics.fmean(highs), 1),
                "min_c": round(statistics.fmean(lows), 1),
                "max_low_c": round(_percentile(highs, 0.1), 1),
                "max_high_c": round(_percentile(highs, 0.9), 1),
                "precipitation_mm": round(statistics.fmean(rain), 1) if rain else None,
                # Доля прогонов с осадками от 1 мм — та же «вероятность», что у
                # обычного прогноза, только посчитанная по ансамблю.
                "precipitation_probability": round(100 * sum(1 for v in rain if v >= 1) / len(rain)) if rain else None,
                "sea_c": round(statistics.fmean(sea), 1) if sea else None,
            }
        )
    return rows


def parse_months(body: dict | None) -> list[dict]:
    """Сезонный месячный → средние и отклонения от нормы на полгода."""
    if not body:
        return []
    monthly = body.get("monthly") or {}
    rows = []
    for i, month in enumerate(monthly.get("time") or []):
        temperature = _num(_column(monthly, "temperature_2m_mean", i))
        if temperature is None:
            continue
        sunshine = _num(_column(monthly, "sunshine_duration_mean", i))
        rows.append(
            {
                "month": str(month)[:7],
                "temperature_c": round(temperature, 1),
                "anomaly_c": _num(_column(monthly, "temperature_2m_anomaly", i)),
                "precipitation_mm": _num(_column(monthly, "precipitation_mean", i)),
                "precipitation_anomaly_mm": _num(_column(monthly, "precipitation_anomaly", i)),
                "sea_c": _celsius(_column(monthly, "sea_surface_temperature_mean", i)),
                "sunshine_h": round(sunshine / 3600) if sunshine is not None else None,
            }
        )
    return rows


def parse_marine(body: dict | None) -> dict | None:
    """Море. Не у моря провайдер отвечает пустыми значениями — раздела нет."""
    if not body:
        return None
    current = body.get("current") or {}
    sea = _num(current.get("sea_surface_temperature"))
    wave = _num(current.get("wave_height"))
    if sea is None and wave is None:
        return None
    daily = body.get("daily") or {}
    return {
        "sea_c": sea,
        "wave_m": wave,
        "wave_period_s": _num(current.get("wave_period")),
        "wave_dir": _int(current.get("wave_direction")),
        "daily": [
            {
                "date": day,
                "wave_max_m": _num(_column(daily, "wave_height_max", i)),
                "wave_dir": _int(_column(daily, "wave_direction_dominant", i)),
                "wave_period_s": _num(_column(daily, "wave_period_max", i)),
            }
            for i, day in enumerate(daily.get("time") or [])
            if _column(daily, "wave_height_max", i) is not None
        ],
    }


def parse_air(body: dict | None) -> dict | None:
    """Качество воздуха. Пыльца — только где её считают (Европа, в сезон)."""
    if not body:
        return None
    current = body.get("current") or {}
    aqi = _int(current.get("european_aqi"))
    us = _int(current.get("us_aqi"))
    if aqi is None and us is None:
        return None
    pollen = {name: _num(current.get(f"{name}_pollen")) for name in POLLEN}
    pollen = {name: value for name, value in pollen.items() if value is not None}
    return {
        "european_aqi": aqi,
        "us_aqi": us,
        "pm2_5": _num(current.get("pm2_5")),
        "pm10": _num(current.get("pm10")),
        "ozone": _num(current.get("ozone")),
        "nitrogen_dioxide": _num(current.get("nitrogen_dioxide")),
        "sulphur_dioxide": _num(current.get("sulphur_dioxide")),
        "carbon_monoxide": _num(current.get("carbon_monoxide")),
        "dust": _num(current.get("dust")),
        "uv_index": _num(current.get("uv_index")),
        # Пустой словарь и «пыльцы нет» — разное: нули значат «сейчас не пылит».
        "pollen": pollen or None,
    }


def fetch_detail(latitude: float, longitude: float, *, urls: dict, timezone_name: str) -> dict | None:
    """Все разделы для точки. `None` — не ответил даже основной прогноз."""
    point = {"latitude": latitude, "longitude": longitude, "timezone": timezone_name or "UTC"}
    forecast = parse_forecast(
        _get(
            f"{urls['forecast']}/v1/forecast",
            {**point, "current": CURRENT, "hourly": HOURLY, "daily": DAILY, "forecast_days": FORECAST_DAYS, "wind_speed_unit": "ms"},
        )
    )
    if not forecast.get("current") and not forecast.get("daily"):
        return None
    last_day = forecast["daily"][-1]["date"] if forecast.get("daily") else None
    outlook = parse_outlook(
        _get(f"{urls['seasonal']}/v1/seasonal", {**point, "daily": SEASONAL_DAILY, "forecast_days": OUTLOOK_DAYS}),
        after=last_day,
    )
    months = parse_months(_get(f"{urls['seasonal']}/v1/seasonal", {**point, "monthly": SEASONAL_MONTHLY}))
    marine = parse_marine(
        _get(f"{urls['marine']}/v1/marine", {**point, "current": MARINE_CURRENT, "daily": MARINE_DAILY, "forecast_days": 8})
    )
    air = parse_air(_get(f"{urls['air']}/v1/air-quality", {**point, "current": AIR_CURRENT, "forecast_days": 1}))
    return {
        **forecast,
        "outlook": outlook,
        "months": months,
        "marine": marine,
        "air": air,
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
    }
