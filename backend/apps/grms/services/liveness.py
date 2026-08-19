"""
Доступность endpoint'ов узла — то, что коннектор сообщает в heartbeat.

Коннектор уже присылает результат ЛОКАЛЬНОЙ проверки каждого endpoint'а
(`connector/itv_connector/client.py`, контракт backend-connector.md §4):

    {"type": "connector.heartbeat",
     "endpoints": {"iridi": {"reachable": true, "latency_ms": 12, ...}}}

До G5 консьюмер это поле молча выбрасывал: транспорту оно было не нужно, а
гостевой стороны, которой оно нужно, ещё не существовало. Здесь оно наконец
доезжает до потребителя.

ХРАНИМ В КЭШЕ, А НЕ В БАЗЕ, и это не «чтобы попроще». Признак живёт 30 секунд
и переписывается каждый heartbeat: колонка в `hotels_onprem_node` означала бы
запись в базу раз в полминуты на каждый отель ради значения, которое к
следующей минуте уже неверно. Плюс TTL сам решает главную задачу контракта —
УСТАРЕВШЕЕ НЕ ПОКАЗЫВАЕТСЯ: протухшая запись исчезает, а не превращается в
«всё хорошо».

Отличать «сообщили, что недоступен» от «ещё не сообщали» обязательно. Узел,
подключившийся секунду назад, первый heartbeat прислать не успел, и если
считать молчание отказом, экран мигал бы «недоступно» на каждом переподключении
коннектора.
"""

from __future__ import annotations

from django.core.cache import cache

from apps.grms.transport import adapter

# Тот же порог, что у «узел жив»: три пропущенных отметки. Своей константы
# здесь заводить нельзя — разъедутся.
from apps.hotels.models import OnPremNode

ENDPOINTS_TTL_S = OnPremNode.OFFLINE_AFTER_SECONDS


def _key(hotel_id) -> str:
    return f"grms:endpoints:{hotel_id}"


def remember_endpoints(hotel_id, endpoints: dict | None) -> None:
    """Запомнить то, что пришло в heartbeat. Пустое сообщение — не новость."""
    if not endpoints or not isinstance(endpoints, dict):
        return
    payload = {
        name: bool((probe or {}).get("reachable"))
        for name, probe in endpoints.items()
        if isinstance(probe, dict)
    }
    if payload:
        cache.set(_key(hotel_id), payload, ENDPOINTS_TTL_S)


def observe(hotel_id, reachable: bool, name: str = adapter.ENDPOINT_IRIDI) -> None:
    """
    Записать то, что выяснила НАСТОЯЩАЯ попытка чтения.

    Heartbeat приходит раз в минуту, а «узел жив» держится три минуты — между
    падением коннектора и истечением этого порога есть окно до трёх минут,
    в котором опрос уже не проходит, а признака недоступности ещё нет
    ниоткуда. Единственный, кто в этот момент знает правду, — тот, кто только
    что попытался прочитать и не смог.

    Пишем в тот же ключ и с тем же TTL, что и heartbeat: он остаётся
    источником истины, а это лишь заполняет паузу между его сообщениями.
    Заодно снимается плата за таймаут — следующий опрос отвечает сразу, не
    дожидаясь молчания по каждому каналу.
    """
    known = cache.get(_key(hotel_id))
    payload = dict(known) if isinstance(known, dict) else {}
    payload[name] = bool(reachable)
    cache.set(_key(hotel_id), payload, ENDPOINTS_TTL_S)


def endpoint_reachable(hotel_id, name: str = adapter.ENDPOINT_IRIDI) -> bool | None:
    """
    True / False / None, где None — «узел про этот endpoint ещё не сообщал».

    None НЕ равно False намеренно: см. модульный комментарий. Решение, что
    делать с неизвестностью, принимает вызывающий, а не хранилище.
    """
    known = cache.get(_key(hotel_id))
    if not isinstance(known, dict) or name not in known:
        return None
    return bool(known[name])


def forget(hotel_id) -> None:
    """Узел отключился — прежние замеры больше ничего не значат."""
    cache.delete(_key(hotel_id))
    forget_silent_reads(hotel_id)


# --- Молчащие чтения подряд --------------------------------------------------
#
# Одно молчание и два молчания подряд — разные новости, и различать их больше
# нечем. Узел числится живым (heartbeat трёхминутный), endpoint про себя ещё
# ничего не сообщал, а канал не ответил: это одинаково выглядит и когда
# коннектор поднялся секунду назад, и когда оборудование действительно умерло.
#
# Счётчик живёт столько же, сколько признак живости: он про ту же связь, и
# пережить её не должен. Держать его дольше значит помнить молчание, которого
# уже никто не подтверждает.

_SILENT_TTL_S = ENDPOINTS_TTL_S


def _silent_key(hotel_id) -> str:
    return f"grms:silent_reads:{hotel_id}"


def note_silent_read(hotel_id) -> tuple[int, float]:
    """
    Записать молчащее чтение. Возвращает (какое оно подряд, сколько секунд
    молчит).

    ВОЗРАСТ ТУТ НЕ УКРАШЕНИЕ. Одного счётчика мало: чтения одного устройства
    схлопываются на `commands.READ_COALESCE_S`, и два запроса подряд внутри
    этого окна дают ДВА молчания на ОДНУ настоящую попытку. Считать это
    подтверждением значит объявить отказ, ни разу больше не сходив к
    оборудованию, — а клиент, опрашивающий часто, получил бы отказ быстрее
    того, кто ждёт.

    Поэтому решение принимается по двум признакам сразу: и попыток было
    больше одной, и прошло достаточно, чтобы хоть одна из них дошла до железа.
    """
    import time

    key = _silent_key(hotel_id)
    now = time.monotonic()
    known = cache.get(key)
    if isinstance(known, dict) and "count" in known:
        entry = {"count": int(known["count"]) + 1, "since": float(known.get("since", now))}
    else:
        entry = {"count": 1, "since": now}
    cache.set(key, entry, _SILENT_TTL_S)
    return entry["count"], max(0.0, now - entry["since"])


def forget_silent_reads(hotel_id) -> None:
    """Прочитали — счётчик молчаний обнуляется."""
    cache.delete(_silent_key(hotel_id))
