"""
Настройки прогона тестов.

Отличие от боевых ровно одно и named: У КАЖДОГО ПРОЦЕССА ПРОГОНА СВОЯ БАЗА
REDIS. Всё остальное наследуется — тесты обязаны гонять ту же конфигурацию,
что и продукт, иначе они проверяют не его.

ЗАЧЕМ. В кэше живут счётчики попыток PIN, признак «команда в полёте» и
доступность endpoint'ов узла — то есть состояние, на которое тесты опираются
внутри одного теста. Фикстура `_clean_cache` чистит кэш до и после каждого
теста, а чистка у Redis — это FLUSHDB, вся база целиком.

Пока база была общей, при `-n 4` это означало: девятьсот тестов в четырёх
процессах делают по два FLUSHDB каждый ПО ОДНОЙ И ТОЙ ЖЕ базе. Чужая чистка,
попавшая в середину теста, стирала его состояние. Ловилось это как
«падает через раз»: `test_wrong_pin_counts_down_and_then_blocks` делает семь
попыток подряд и ждёт блокировку, а после чужого FLUSHDB счётчик обнулялся и
седьмая попытка возвращала 401 вместо 429.

Postgres так уже разведён — pytest-django добавляет к имени базы суффикс
воркера. Кэш обязан быть разведён так же, и по той же причине.

ПОЧЕМУ ЗДЕСЬ, А НЕ В ФИКСТУРЕ. Выбор базы — свойство ПРОЦЕССА, а не теста.
В фикстуре он выполнялся бы девятьсот раз и на каждый тест переписывал
`settings.CACHES`; здесь — один раз при старте процесса, и в одном месте.
"""

from __future__ import annotations

import os

from config.settings import *  # noqa: F401,F403
from config.settings import CACHES as _BASE_CACHES

# Индексы баз Redis: 0..15 при настройке по умолчанию (`databases 16`).
REDIS_DB_COUNT = int(os.getenv("REDIS_DB_COUNT", "16"))

# С какой базы начинается диапазон прогона. 4 занята dev-стендом
# (`CACHE_URL` в docker-compose.yml), и трогать её нельзя: прогон тестов
# посреди ручной проверки сбрасывал бы стенду команды в полёте.
TEST_CACHE_FIRST_DB = 5


def _worker_index() -> int:
    """
    Номер процесса из `PYTEST_XDIST_WORKER`: gw0 → 0, gw1 → 1.

    Переменной нет — значит xdist не участвует (`-n 0`, отладка одного файла,
    прямой запуск). Тогда процесс один и номер его нулевой.
    """
    worker = os.getenv("PYTEST_XDIST_WORKER", "")
    suffix = worker[2:] if worker.startswith("gw") else ""
    return int(suffix) if suffix.isdigit() else 0


def _worker_count() -> int:
    """Сколько процессов в прогоне. Без xdist — один."""
    raw = os.getenv("PYTEST_XDIST_WORKER_COUNT", "")
    return int(raw) if raw.isdigit() and int(raw) > 0 else 1


def _redis_url_without_db(url: str) -> str:
    return url.rpartition("/")[0]


_index = _worker_index()
_base_url = _redis_url_without_db(_BASE_CACHES["default"]["LOCATION"])

# Решение принимается на ВЕСЬ ПРОГОН, а не поворкерно, и это существенно.
# Поворкерное «мне базы хватило» давало смешанную картину: gw0 владеет базой 5
# монопольно и чистит её через FLUSHDB, а переполнившиеся gw2 и gw3 кладут
# туда же свои ключи с префиксом — и gw0 стирает их вместе со своими. Либо
# своя база у всех, либо префикс у всех.
CACHE_ISOLATED_BY_DB = TEST_CACHE_FIRST_DB + _worker_count() - 1 < REDIS_DB_COUNT

if CACHE_ISOLATED_BY_DB:
    _db = TEST_CACHE_FIRST_DB + _index
    CACHE_KEY_PREFIX = ""
else:
    # Процессов больше, чем свободных баз. Не падаем и не делим базу молча:
    # все уходят в первую и расходятся префиксом ключей.
    _db = TEST_CACHE_FIRST_DB
    CACHE_KEY_PREFIX = os.getenv("PYTEST_XDIST_WORKER", "gw0")

CACHES = {
    "default": {
        **_BASE_CACHES["default"],
        "LOCATION": f"{_base_url}/{_db}",
        "KEY_PREFIX": CACHE_KEY_PREFIX,
    }
}
