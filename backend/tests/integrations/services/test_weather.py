"""
Погода на главной: кэш, частота обращений и правило «нет свежего — нет блока».

ВНЕШНИЙ СЕРВИС ЗДЕСЬ ЗАМОКАН ВЕЗДЕ. Тест, который ходит в интернет, — это не
тест продукта, а тест канала до Open-Meteo: он краснеет от чужого сбоя и молчит
о нашем. Провайдер подменяется целиком, и заодно становится видно то, ради чего
всё затевалось: СКОЛЬКО РАЗ его позвали.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
from django.core.cache import cache

from apps.integrations.weather import service
from apps.integrations.weather.base import CurrentWeather

pytestmark = pytest.mark.django_db


class FakeProvider:
    """Считает вызовы и отдаёт то, что велено."""

    def __init__(self, observation: CurrentWeather | None):
        self.observation = observation
        self.calls = 0

    def current(self, latitude: float, longitude: float):
        self.calls += 1
        self.point = (latitude, longitude)
        return self.observation


def observation(minutes_ago: int = 0, *, code: int = 3, temp: float = 21.4) -> CurrentWeather:
    return CurrentWeather(
        temperature_c=temp,
        code=code,
        is_day=True,
        observed_at=datetime.now(tz=timezone.utc) - timedelta(minutes=minutes_ago),
    )


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _tasks_run_here(settings):
    """
    Фоновая задача исполняется НЕМЕДЛЕННО и в этом же процессе.

    По умолчанию в тестах она уехала бы в брокер, и проверять было бы нечего:
    вызовы провайдера считает воркер, до которого тесту не дотянуться.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True


@pytest.fixture
def hotel_with_point(crystal):
    hotel = crystal
    hotel.latitude = 55.751244
    hotel.longitude = 37.618423
    hotel.settings = {**(hotel.settings or {}), "home": {"weather": True}}
    hotel.save(update_fields=["latitude", "longitude", "settings"])
    return hotel


def _use(monkeypatch, provider: FakeProvider) -> None:
    # Подменяем ОДНО место — фабрику в сервисе. Задача берёт провайдера через
    # неё же, поэтому патчить её отдельно не нужно: разойдись эти два пути,
    # тест перестал бы проверять то, что исполняется в проде.
    monkeypatch.setattr(service, "get_provider", lambda: provider)


def test_first_read_fetches_and_caches(monkeypatch, hotel_with_point):
    """Первое чтение ставит фоновую задачу; она и ходит к провайдеру."""
    provider = FakeProvider(observation())
    _use(monkeypatch, provider)

    service.current_for(hotel_with_point)
    payload = service.cached(hotel_with_point)

    assert provider.calls == 1
    assert provider.point == (55.751244, 37.618423)
    assert payload["temperature_c"] == 21.4
    assert payload["code"] == 3


def test_many_guests_one_call(monkeypatch, hotel_with_point):
    """
    ЧАСТОТА НЕ ЗАВИСИТ ОТ ЧИСЛА ГОСТЕЙ — ради этого всё и сделано.

    Сто открытий главной подряд обязаны дать ОДИН вызов провайдера: рядом с
    данными лежит кулдаун, и пока он жив, новых задач не ставится.
    """
    provider = FakeProvider(observation())
    _use(monkeypatch, provider)

    for _ in range(100):
        service.current_for(hotel_with_point)

    assert provider.calls == 1


def test_stale_value_is_not_served(monkeypatch, hotel_with_point):
    """
    Протухшее не показывается. Это то же враньё, что и старое состояние номера:
    гость читает число как «сейчас», а оно из позавчера.
    """
    provider = FakeProvider(observation(minutes_ago=service.FRESH_FOR // 60 + 5))
    _use(monkeypatch, provider)

    service.current_for(hotel_with_point)
    assert service.cached(hotel_with_point) is None


def test_provider_down_hides_block(monkeypatch, hotel_with_point):
    """Провайдер молчит — блока нет. Ни прочерков, ни заглушек."""
    provider = FakeProvider(None)
    _use(monkeypatch, provider)

    assert service.current_for(hotel_with_point) is None
    assert provider.calls == 1


def test_no_coordinates_no_weather(monkeypatch, crystal):
    """
    Нет координат — провайдера не беспокоим вовсе.

    Координаты у демо-отеля сид ставит (иначе блок не увидеть на стенде),
    поэтому здесь они СНИМАЮТСЯ явно: тест про отель без точки, а не про то,
    что сегодня лежит в сиде.
    """
    hotel = crystal
    hotel.latitude = None
    hotel.longitude = None
    hotel.settings = {**(hotel.settings or {}), "home": {"weather": True}}
    hotel.save(update_fields=["latitude", "longitude", "settings"])
    provider = FakeProvider(observation())
    _use(monkeypatch, provider)

    assert service.current_for(hotel) is None
    assert provider.calls == 0


def test_disabled_by_hotel_no_weather(monkeypatch, hotel_with_point):
    """Отель погоду не включал — тоже не ходим: это его решение, а не наше."""
    hotel_with_point.settings = {**(hotel_with_point.settings or {}), "home": {"weather": False}}
    hotel_with_point.save(update_fields=["settings"])
    provider = FakeProvider(observation())
    _use(monkeypatch, provider)

    assert service.current_for(hotel_with_point) is None
    assert provider.calls == 0


def test_refresh_when_due(monkeypatch, hotel_with_point):
    """
    Пора обновлять — обновляем, и старое значение при этом ещё показывается:
    между «пора» и «протухло» блок живёт нормальной жизнью.
    """
    provider = FakeProvider(observation(minutes_ago=service.REFRESH_AFTER // 60 + 1))
    _use(monkeypatch, provider)
    service.current_for(hotel_with_point)
    assert provider.calls == 1

    # Значение уже «пора обновить», но ещё не протухло — оно отдаётся.
    cached = service.cached(hotel_with_point)
    assert cached is not None

    # Кулдаун держит: повторное чтение второй задачи не ставит.
    service.current_for(hotel_with_point)
    assert provider.calls == 1


def test_open_meteo_parses_answer(monkeypatch):
    """Разбор ответа провайдера — на форме, которую он реально отдаёт."""
    from apps.integrations.weather.open_meteo import OpenMeteoProvider

    class Response:
        ok = True
        status_code = 200

        @staticmethod
        def json():
            return {"current": {"temperature_2m": -3.2, "weather_code": 71, "is_day": 0}}

    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **kw: Response())
    result = OpenMeteoProvider("http://weather.local").current(59.9, 30.3)

    assert result is not None
    assert result.temperature_c == -3.2
    assert result.code == 71
    assert result.is_day is False


def test_open_meteo_survives_garbage(monkeypatch):
    """Ответ не той формы равен отсутствию ответа, а не исключению наружу."""
    from apps.integrations.weather.open_meteo import OpenMeteoProvider

    class Response:
        ok = True
        status_code = 200

        @staticmethod
        def json():
            return {"unexpected": True}

    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **kw: Response())
    assert OpenMeteoProvider("http://weather.local").current(59.9, 30.3) is None


def test_open_meteo_survives_network_error(monkeypatch):
    """Сеть легла — `None`, а не падение задачи."""
    from apps.integrations.weather.open_meteo import OpenMeteoProvider

    import requests

    def boom(*args, **kwargs):
        raise OSError("сеть недоступна")

    monkeypatch.setattr(requests, "get", boom)
    assert OpenMeteoProvider("http://weather.local").current(59.9, 30.3) is None


def test_base_url_from_settings(monkeypatch, settings):
    """
    Адрес провайдера — из настройки: в проде это свой экземпляр, и подменяться
    он должен окружением, а не правкой кода.
    """
    settings.WEATHER_API_URL = "http://weather.internal:8080"
    provider = service.get_provider()
    assert provider.base_url == "http://weather.internal:8080"


# --- Кулдаун: короткий до успеха, длинный после -----------------------------
#
# Найдено на стенде 21.09.2026. Провайдер ответил 503 в момент перезапуска,
# и блок погоды погас у всех трёх отелей НА ДВАДЦАТЬ МИНУТ: кулдаун ставился
# до попытки и не снимался при неудаче, а повторить было некому — следующий
# гость видел пустой блок и уходил, ничего не запустив. Пятью минутами позже
# тот же запрос с того же сервера отвечал 200.


def test_a_failed_attempt_lets_the_next_guest_try_soon(monkeypatch, hotel_with_point):
    """
    Провайдер отказал — следующая попытка приходит ПО КОРОТКОМУ сроку, а не
    через двадцать минут.

    Проверяем ПОВЕДЕНИЕМ, а не длиной ключа в кэше: сколько там секунд — дело
    реализации, а важно, получит ли гость погоду.
    """
    monkeypatch.setattr(service, "RETRY_AFTER_FAILURE", 1)
    silent = FakeProvider(None)
    _use(monkeypatch, silent)

    assert service.current_for(hotel_with_point) is None
    assert silent.calls == 1

    # Сразу второй гость лишней попытки не создаёт: провайдера бережём.
    service.current_for(hotel_with_point)
    assert silent.calls == 1, "после отказа пошла вторая попытка подряд"

    # Короткий срок истёк — провайдер уже отвечает, и гость получает погоду.
    time.sleep(1.2)
    alive = FakeProvider(observation())
    _use(monkeypatch, alive)
    service.current_for(hotel_with_point)
    assert alive.calls == 1, "после отказа новая попытка так и не пришла"
    assert service.current_for(hotel_with_point) is not None


def test_a_long_outage_is_polled_no_more_than_once_per_window(monkeypatch, hotel_with_point):
    """
    Обратная сторона: провайдер лежит по-настоящему — долбить его нельзя.

    Совсем снять кулдаун было бы хуже болезни: каждый гость на главной звал бы
    лежащий сервис. Десять гостей подряд дают ОДНУ попытку.
    """
    down = FakeProvider(None)
    _use(monkeypatch, down)

    for _ in range(10):
        service.current_for(hotel_with_point)
    assert down.calls == 1, f"лежащий провайдер получил {down.calls} попыток вместо одной"


def test_a_success_extends_the_cooldown_to_the_full_term(monkeypatch, hotel_with_point):
    """
    Удача продлевает кулдаун до штатного: данные свежие, ходить незачем.

    Без этого короткий ключ означал бы поход к провайдеру раз в минуту ВСЕГДА
    — ровно ту долбёжку, от которой кулдаун и защищает.

    Значение берём постаревшее: обновлять уже пора (старше `REFRESH_AFTER`), а
    показывать ещё можно (моложе `FRESH_FOR`). Тогда каждая следующая попытка
    упирается именно в кулдаун, а не в проверку возраста.
    """
    monkeypatch.setattr(service, "RETRY_AFTER_FAILURE", 1)
    stale_but_shown = observation(minutes_ago=service.REFRESH_AFTER // 60 + 5)
    provider = FakeProvider(stale_but_shown)
    _use(monkeypatch, provider)

    service.current_for(hotel_with_point)
    assert provider.calls == 1

    # Короткий срок заведомо истёк. Если бы удача его не продлила, здесь пошла
    # бы вторая попытка — и так каждую минуту до скончания века.
    time.sleep(1.2)
    service.current_for(hotel_with_point)
    assert provider.calls == 1, (
        f"после удачи кулдаун остался коротким: попыток {provider.calls} — провайдера зовут каждую минуту"
    )
