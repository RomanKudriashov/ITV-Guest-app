"""
Реестр типов трекеров.

Здесь — ЕДИНСТВЕННОЕ место, где система знает, чем доска ресторана отличается
от очереди хозслужбы. Прикладной код спрашивает у реестра поведение, а не
сравнивает тип сервиса со строкой:

    behaviour = tracker_behaviour(point)
    if behaviour.layout == Layout.TIMELINE:   # а НЕ: if service.type == "spa"
        ...

Тип трекера ВЫВОДИТСЯ из типа сервиса (карта продукта, Часть 3), а не хранится
отдельным полем: два источника правды разошлись бы на первом же переименовании
сервиса. Сервис ↔ исполнитель 1:1 (R1), поэтому у точки исполнения тип трекера
определён однозначно; точка без сервиса (теоретический случай) падает на свой
род (ExecutionPoint.Kind).

Правило на будущее: новый вид сервиса — это новая строка в SERVICE_TYPE_TO_TRACKER
и, если он работает иначе, новая строка в BEHAVIOURS. Если вид потребовал форка
доски, действий или потока статусов в прикладном коде, значит треснула модель.

Поток статусов у каждого типа свой — apps/orders/status_flows.py.
"""

from __future__ import annotations

import dataclasses

from django.db import models


class TrackerType(models.TextChoices):
    BOARD = "board", "Доска заказов"
    QUEUE = "queue", "Очередь заявок"
    SCHEDULE = "schedule", "Записи на сегодня"
    REQUESTS = "requests", "Заявки на подачу"


class Layout(models.TextChoices):
    """Как клиент рисует задачи. Сервер говорит чем, а не как именно."""

    COLUMNS = "columns", "Колонки по статусам"
    TIMELINE = "timeline", "Лента по времени"


@dataclasses.dataclass(frozen=True, slots=True)
class TrackerBehaviour:
    code: str
    layout: str
    # По какому полю сортируются задачи в активном скоупе. У записей это время
    # начала слота: спа-мастер смотрит «кто следующий», а не «что раньше
    # заказали». У остальных — момент создания, как было у кухни.
    order_by: str
    # Показывать ли колонку-корзину терминальных статусов. У ленты записей
    # завершённые остаются на месте (день видно целиком), у досок — уходят.
    keeps_terminal_in_view: bool


BEHAVIOURS: dict[str, TrackerBehaviour] = {
    TrackerType.BOARD: TrackerBehaviour(
        code=TrackerType.BOARD,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
    ),
    TrackerType.QUEUE: TrackerBehaviour(
        code=TrackerType.QUEUE,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
    ),
    TrackerType.SCHEDULE: TrackerBehaviour(
        code=TrackerType.SCHEDULE,
        layout=Layout.TIMELINE,
        order_by="slot_start",
        keeps_terminal_in_view=True,
    ),
    TrackerType.REQUESTS: TrackerBehaviour(
        code=TrackerType.REQUESTS,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
    ),
}


# Тип сервиса (hotels.Service.Type) → тип трекера. Рум-сервис и мини-бар —
# те же доски заказов: у них каталог и та же работа «принял → отдал».
SERVICE_TYPE_TO_TRACKER: dict[str, str] = {
    "restaurant": TrackerType.BOARD,
    "bar": TrackerType.BOARD,
    "room_service": TrackerType.BOARD,
    "minibar": TrackerType.BOARD,
    "housekeeping": TrackerType.QUEUE,
    "spa": TrackerType.SCHEDULE,
    "pool": TrackerType.SCHEDULE,
    "excursions": TrackerType.SCHEDULE,
    "transfer": TrackerType.REQUESTS,
    "concierge": TrackerType.REQUESTS,
    # info у гостя без действия, custom — свой набор кирпичей; и то и другое
    # обслуживается доской: она не навязывает ни слотов, ни формы.
    "info": TrackerType.BOARD,
    "custom": TrackerType.BOARD,
}

# Падение для точки исполнения без сервиса. Держать синхронным с
# hotels/venue_defaults.py::KIND_TO_SERVICE_TYPE — это его продолжение.
POINT_KIND_TO_TRACKER: dict[str, str] = {
    "kitchen": TrackerType.BOARD,
    "bar": TrackerType.BOARD,
    "housekeeping": TrackerType.QUEUE,
    "spa": TrackerType.SCHEDULE,
    "reception": TrackerType.REQUESTS,
    "other": TrackerType.BOARD,
}


def tracker_type_for_service_type(service_type: str) -> str:
    """Неизвестный тип сервиса — доска: самый нейтральный набор правил."""
    return SERVICE_TYPE_TO_TRACKER.get(service_type, TrackerType.BOARD)


def tracker_type_for_point(point) -> str:
    """
    Тип трекера точки исполнения.

    Сервис читается через кэш `_prefetched_objects_cache`, если вызывающий уже
    сделал prefetch: доска зовёт это на каждую точку в списке.
    """
    service = _service_of(point)
    if service is not None:
        return tracker_type_for_service_type(service.type)
    return POINT_KIND_TO_TRACKER.get(point.kind, TrackerType.BOARD)


def _service_of(point):
    cache = getattr(point, "_prefetched_objects_cache", None) or {}
    if "services" in cache:
        return next(iter(cache["services"]), None)
    return point.services.first()


def tracker_behaviour(point) -> TrackerBehaviour:
    return BEHAVIOURS[tracker_type_for_point(point)]


def behaviour_for_type(tracker_type: str) -> TrackerBehaviour:
    return BEHAVIOURS.get(tracker_type, BEHAVIOURS[TrackerType.BOARD])
