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
