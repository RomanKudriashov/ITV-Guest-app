"""
Погода отеля: кэш, частота обращений и правило «нет свежего — нет блока».

ТРИ ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ ГЛАВНЫЕ.

1. НА ПРОВАЙДЕРА ХОДИТ ТОЛЬКО СЕРВЕР. Гостевое приложение о провайдере не знает
   и адреса его не видит: оно получает готовые «21.4 и код 3» вместе с главной.
   Иначе тысяча гостей в отеле — тысяча обращений к чужому сервису с их IP.

2. ЧАСТОТА НЕ ЗАВИСИТ ОТ ЧИСЛА ГОСТЕЙ. Обновление идёт фоновой задачей, а
   запускает её первый гость, увидевший протухший кэш, — но ровно один: рядом с
   данными лежит ключ-кулдаун, и пока он жив, новых задач не ставится. Сто
   одновременных открытий главной дают один вызов провайдера.

3. СТАРОЕ НЕ ПОКАЗЫВАЕМ. У данных два срока: `REFRESH_AFTER` — пора обновить, и
   `FRESH_FOR` — после этого значение перестаёт быть правдой и не отдаётся
   вовсе. Между ними живёт нормальная работа: гость видит погоду пятнадцати
   минут назад, пока в фоне едет новая. За `FRESH_FOR` блок исчезает — это
   честнее прочерка и честнее вчерашних градусов.

Отдельным следствием: отель, на главную которого никто не заходит, никого не
опрашивает вовсе.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

# Пора обновлять и докуда значение остаётся правдой. Второе с запасом на одну
# пропущенную попытку: провайдер моргнул — блок не мигает вместе с ним.
REFRESH_AFTER = int(getattr(settings, "WEATHER_REFRESH_SECONDS", 20 * 60))
FRESH_FOR = int(getattr(settings, "WEATHER_FRESH_SECONDS", 45 * 60))

CACHE_PREFIX = "weather:v1"


def _key(hotel_id) -> str:
    return f"{CACHE_PREFIX}:{hotel_id}"


def _cooldown_key(hotel_id) -> str:
    return f"{CACHE_PREFIX}:cooldown:{hotel_id}"


def get_provider():
    """
    Провайдер по настройке. Имя сервиса живёт здесь и только здесь: сменить
    его — правка настроек, а не поход по коду.
    """
    from .open_meteo import OpenMeteoProvider

    name = getattr(settings, "WEATHER_PROVIDER", "open-meteo")
    base_url = getattr(settings, "WEATHER_API_URL", "https://api.open-meteo.com")
    if name == "open-meteo":
        return OpenMeteoProvider(base_url)
    raise ValueError(f"Неизвестный провайдер погоды: {name}")


def coordinates_of(hotel) -> tuple[float, float] | None:
    """Координаты отеля или `None` — заполнены обе или ни одной."""
    if hotel.latitude is None or hotel.longitude is None:
        return None
    return float(hotel.latitude), float(hotel.longitude)


def is_enabled(hotel) -> bool:
    """
    Погода включена отелем И у него есть координаты.

    По умолчанию ВЫКЛЮЧЕНА: блок на главной — решение отеля, а не наше, и
    молча ходить за него в чужой сервис мы не станем.
    """
    if coordinates_of(hotel) is None:
        return False
    home = (hotel.settings or {}).get("home") or {}
    return bool(home.get("weather", False))


def cached(hotel) -> dict | None:
    """Свежее наблюдение из кэша или `None`. Ничего не запрашивает."""
    entry = cache.get(_key(hotel.pk))
    if not entry:
        return None
    age = (timezone.now() - timezone.datetime.fromisoformat(entry["observed_at"])).total_seconds()
    if age > FRESH_FOR:
        # Протухло. Не отдаём и не удаляем: ключ и так уйдёт по TTL, а гонки за
        # удаление здесь никому не нужны.
        return None
    return entry


def store(hotel_id, observation) -> dict:
    payload = observation.as_payload()
    # TTL кэша равен сроку годности данных: даже если проверка возраста однажды
    # разъедется с этим значением, протухшему значению просто негде лежать.
    cache.set(_key(hotel_id), payload, FRESH_FOR)
    return payload


def ensure_fresh(hotel) -> None:
    """
    Поставить фоновое обновление, если пора — и ровно одно на отель.

    Кулдаун ставится ДО задачи: две одновременные главные не должны обе решить,
    что обновлять надо им. `add` атомарен и возвращает False, если ключ уже
    занят кем-то.
    """
    entry = cache.get(_key(hotel.pk))
    if entry:
        age = (
            timezone.now() - timezone.datetime.fromisoformat(entry["observed_at"])
        ).total_seconds()
        if age < REFRESH_AFTER:
            return

    if not cache.add(_cooldown_key(hotel.pk), "1", REFRESH_AFTER):
        return

    from apps.integrations.weather.tasks import refresh_hotel_weather

    refresh_hotel_weather.delay(str(hotel.pk))


def current_for(hotel) -> dict | None:
    """
    Погода для главной: готовый payload или `None`.

    `None` означает ровно одно — показывать нечего. Отель не включал погоду, не
    задал координаты, провайдер молчит, значение протухло: для витрины это один
    и тот же случай, и разбираться в нём гостю незачем.
    """
    if not is_enabled(hotel):
        return None
    ensure_fresh(hotel)
    entry = cached(hotel)
    if entry is None:
        return None
    # ЕДИНИЦЫ — РЕШЕНИЕ ОТЕЛЯ, и считает их сервер. «24°» без буквы читается
    # по-разному: американский гость прочтёт это как мороз. В кэше всегда
    # Цельсий — пересчёт дешевле, чем два кэша и вопрос «в чём тут градусы».
    units = getattr(hotel, "temperature_units", "c") or "c"
    celsius = entry["temperature_c"]
    return {
        **entry,
        "units": units,
        "temperature": round(celsius * 9 / 5 + 32) if units == "f" else round(celsius),
    }


# --- Справочник городов ---------------------------------------------------------

CITY_CACHE_SECONDS = 24 * 60 * 60


def search_cities(query: str, language: str) -> list[dict] | None:
    """
    Подсказка городов для CMS. `None` — справочник не ответил (это не «ничего
    не найдено», и экран обязан сказать об этом по-разному).

    Ответы кэшируются на сутки: оператор набирает город по буквам, и каждое
    нажатие не должно уходить к провайдеру — у него лимиты, у нас они общие
    на весь флот.
    """
    query = (query or "").strip()
    language = (language or "en").split("-")[0]
    if len(query) < 2:
        return []
    key = f"{CACHE_PREFIX}:cities:{language}:{query.casefold()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    provider = get_provider()
    matches = provider.search_cities(query, language)
    if matches is None:
        return None
    payload = [match.as_payload() for match in matches]
    cache.set(key, payload, CITY_CACHE_SECONDS)
    return payload


def city_by_id(city_id: int, language: str) -> dict | None:
    """Запись справочника по идентификатору, на нужном языке. С кэшем на сутки."""
    key = f"{CACHE_PREFIX}:city:{language}:{int(city_id)}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    match = get_provider().city(int(city_id), language)
    if match is None:
        return None
    payload = match.as_payload()
    cache.set(key, payload, CITY_CACHE_SECONDS)
    return payload


def city_in_languages(city_id: int, languages) -> dict[str, str]:
    """
    Название города НА ЯЗЫКАХ ОТЕЛЯ — чтобы английская витрина не писала
    «Москва». Берём запись по идентификатору на каждом языке: поиском это не
    сделать, справочник ищет по написанию и «Сочи» по-английски не находит.
    Языка без перевода нет: провайдер отдаёт английское или родное имя.
    """
    names: dict[str, str] = {}
    for language in languages:
        row = city_by_id(city_id, language)
        if row and row.get("name"):
            names[language] = row["name"]
    return names
