"""
Потоки статусов — по одному на тип трекера.

До R3 у отеля был ОДИН плоский пресет статусов, и по нему жили все отделы:
горничная закрывала заявку статусом «Доставлено», консьерж вёз такси через
«Готовится». R3 разводит потоки по типам трекера (apps/orders/tracker_types.py):
у доски свой набор, у очереди свой, у записей свой.

Два правила, на которых всё держится:

1. **Поток «board» неприкосновенен.** Это ровно тот пресет, по которому кухня
   работала до R3 — те же коды, порядок, флаги и токены цветов. Обобщение не
   имело права поменять поведение существующего трекера, поэтому board тут
   переписан один-в-один, а миграция проставляет `flow="board"` всем старым
   строкам.
2. **Коды уникальны в рамках потока, а не отеля.** `new` есть и у доски, и у
   заявок консьержа — это разные строки с разным продолжением. Поэтому любой
   поиск статуса по коду обязан быть в скоупе потока (см. `status_by_code`).

`stage` — нормализованная ступень, общая для всех потоков. Она нужна ровно в
одном месте: разъехавшийся заказ (R2) собирает статус-свод parent из children,
а те могут жить в другом потоке. Сравнивать `sort_order` разных потоков нельзя
— сравниваем ступени.
"""

from __future__ import annotations

from django.db import models

from apps.orders.services.tracker_types import TrackerType


class Stage(models.TextChoices):
    NEW = "new", "Новая"
    WORKING = "working", "В работе"
    READY = "ready", "Готово"
    DONE = "done", "Завершено"
    CANCELLED = "cancelled", "Отменено"


# Насколько ступень «продвинута». Нужен для статус-свода parent: берётся
# наименее продвинутый активный child. Отмена вне шкалы — у неё своя ветка.
STAGE_RANK: dict[str, int] = {
    Stage.NEW: 0,
    Stage.WORKING: 1,
    Stage.READY: 2,
    Stage.DONE: 3,
}


# code, ru, en, stage, initial, terminal, cancelled, токен цвета, отмена гостем
STATUS_FLOWS: dict[str, list[tuple]] = {
    # --- Ресторан / бар / рум-сервис: доска заказов ---------------------
    # ОДИН-В-ОДИН прежний пресет отеля. Не менять без отдельного решения:
    # на этих кодах стоят гостевой таймлайн, аналитика и E2E.
    TrackerType.BOARD: [
        ("new", "Новый", "New", Stage.NEW, True, False, False, "info", True),
        ("accepted", "Принят", "Accepted", Stage.WORKING, False, False, False, "info", True),
        # С «Готовится» отмена уже закрыта: продукты в работе.
        ("preparing", "Готовится", "Preparing", Stage.WORKING, False, False, False, "warning", False),
        ("on_the_way", "В пути", "On the way", Stage.READY, False, False, False, "warning", False),
        ("done", "Доставлено", "Delivered", Stage.DONE, False, True, False, "success", False),
        ("cancelled", "Отменён", "Cancelled", Stage.CANCELLED, False, True, True, "danger", False),
    ],
    # --- Хозслужба: очередь заявок («взять» / «отметить готово») --------
    TrackerType.QUEUE: [
        ("new", "Новая", "New", Stage.NEW, True, False, False, "info", True),
        ("in_progress", "В работе", "In progress", Stage.WORKING, False, False, False, "warning", False),
        ("done", "Готово", "Done", Stage.DONE, False, True, False, "success", False),
        ("cancelled", "Отменена", "Cancelled", Stage.CANCELLED, False, True, True, "danger", False),
    ],
    # --- Спа: записи на сегодня (отметка прихода → завершено) -----------
    # Гость отменяет запись до прихода — слот освобождается сменой статуса
    # (release_bookings живёт в общей change_status).
    TrackerType.SCHEDULE: [
        ("booked", "Записан", "Booked", Stage.NEW, True, False, False, "info", True),
        ("arrived", "Пришёл", "Arrived", Stage.WORKING, False, False, False, "warning", False),
        ("completed", "Завершено", "Completed", Stage.DONE, False, True, False, "success", False),
        ("cancelled", "Отменена", "Cancelled", Stage.CANCELLED, False, True, True, "danger", False),
    ],
    # --- Такси / консьерж: заявки (подтвердить / выполнено) -------------
    TrackerType.REQUESTS: [
        ("new", "Новая", "New", Stage.NEW, True, False, False, "info", True),
        ("confirmed", "Подтверждена", "Confirmed", Stage.WORKING, False, False, False, "warning", True),
        ("fulfilled", "Выполнена", "Fulfilled", Stage.DONE, False, True, False, "success", False),
        ("cancelled", "Отменена", "Cancelled", Stage.CANCELLED, False, True, True, "danger", False),
    ],
}


# --- Доступ к потоку -------------------------------------------------------
#
# Все четыре функции ниже существуют по одной причине: код статуса сам по себе
# ничего не определяет, определяет пара (поток, код). Прямой
# `StatusDefinition.objects.filter(code=...)` в прикладном коде — баг, который
# проявится, только когда у отеля появится второй поток.


def flow_for_point(point) -> str:
    """Поток статусов точки исполнения = её тип трекера."""
    from apps.orders.services.tracker_types import tracker_type_for_point

    return tracker_type_for_point(point)


def statuses_for_flow(flow: str) -> list:
    from apps.orders.models import StatusDefinition

    return list(StatusDefinition.objects.filter(flow=flow).order_by("sort_order"))


def status_by_code(flow: str, code: str):
    from apps.orders.models import StatusDefinition

    return StatusDefinition.objects.filter(flow=flow, code=code).first()


def initial_status(flow: str):
    from apps.orders.models import StatusDefinition

    return (
        StatusDefinition.objects.filter(flow=flow, is_initial=True)
        .order_by("sort_order")
        .first()
    )


def first_working_status(flow: str, after_sort_order: int = -1):
    """
    Первый рабочий статус после указанного: «Принят» на доске, «В работе» в
    очереди хозслужбы, «Пришёл» в записях спа. Именно сюда переводит «взять
    задачу», и именно его ищет сид, наполняя историю по всем отделам.
    """
    from apps.orders.models import StatusDefinition

    return (
        StatusDefinition.objects.filter(
            flow=flow,
            sort_order__gt=after_sort_order,
            is_cancelled=False,
            is_terminal=False,
        )
        .order_by("sort_order")
        .first()
    )


def terminal_status(flow: str):
    """Завершающий статус потока: «Доставлено» / «Готово» / «Выполнена», не отмена."""
    from apps.orders.models import StatusDefinition

    return (
        StatusDefinition.objects.filter(flow=flow, is_terminal=True, is_cancelled=False)
        .order_by("sort_order")
        .first()
    )


def cancelled_status(flow: str):
    from apps.orders.models import StatusDefinition

    return (
        StatusDefinition.objects.filter(flow=flow, is_cancelled=True)
        .order_by("sort_order")
        .first()
    )


def ensure_status_flows() -> int:
    """
    Идемпотентно завести все потоки текущему отелю (нужен tenant_context).

    Единая точка: её зовут и провижининг нового отеля, и демо-сид. Раньше
    пресет жил только в сиде — свежесозданный отель оставался без статусов и
    падал на первом же заказе.
    """
    from apps.orders.models import StatusDefinition

    written = 0
    for flow, rows in STATUS_FLOWS.items():
        for sort_order, (
            code, ru, en, stage, initial, terminal, cancelled, token, guest_cancel,
        ) in enumerate(rows):
            StatusDefinition.objects.update_or_create(
                flow=flow,
                code=code,
                defaults={
                    "title": {"ru": ru, "en": en},
                    "stage": stage,
                    "sort_order": sort_order,
                    "is_initial": initial,
                    "is_terminal": terminal,
                    "is_cancelled": cancelled,
                    "color_token": token,
                    "allows_guest_cancel": guest_cancel,
                },
            )
            written += 1
    return written
