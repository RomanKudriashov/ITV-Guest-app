"""
СВОДКА СМЕНЫ ТОЧКИ ИСПОЛНЕНИЯ.

Пустая доска ресепшена показывала извинение: значок и «Заказов нет». Заявок
там может не быть часами — экран выглядел сломанным ровно тогда, когда всё в
порядке. Сводка отвечает на другой вопрос: не «есть ли работа сейчас», а
«сколько сделано и как быстро». Ей есть что показать и на пустой доске, и на
полной.

ГРАНИЦА СМЕНЫ — СУТКИ В ТАЙМЗОНЕ ОТЕЛЯ. Настоящих смен (с началом, концом и
пересдачей) в модели нет, и заводить их ради пяти чисел значило бы придумать
сущность под отчёт. Сутки отеля — честное приближение: они не врут про
«сегодня» в полночь, потому что считаются от `hotel.local_now()`, а не от
часов планшета на кухне.

СКОРОСТЬ — МЕДИАНА, А НЕ СРЕДНЕЕ. На стенде среди активных висят заказы,
забытые на двое суток. Одно такое значение утаскивает среднее в бессмыслицу:
двадцать заказов по шесть минут и один на двое суток дают «среднее два с
половиной часа», и повар справедливо перестаёт верить цифре. Медиана этого не
делает — она про типичный заказ, а он и интересует.

ВРЕМЯ ДО ПРИНЯТИЯ СЧИТАЕТСЯ ОТДЕЛЬНО. Это скорость РЕАКЦИИ: сколько заявка
пролежала невзятой. Смешивать её со скоростью исполнения нельзя — медленная
кухня и невнимательная смена лечатся разным.
"""

from __future__ import annotations

from datetime import timedelta

from apps.orders.models import Order, OrderStatusChange
from apps.orders.services.tracker_types import effective_sla_minutes


def _median(values: list[int]) -> int | None:
    """Медиана целых минут. Пусто — None, а не ноль: «нет данных» ≠ «мгновенно»."""
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) // 2


def shift_summary(point, *, hotel, now=None) -> dict:
    """
    Пять чисел смены этой точки.

    `new` / `in_work` / `overdue` — про СЕЙЧАС, по тем же правилам, по которым
    строится доска: без parent-агрегатов, без терминальных. `done` и скорости —
    про смену целиком.
    """
    local_now = now or hotel.local_now()
    started_at = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Та же выборка, что у доски: parent-агрегат исполнением не является, и
    # считать его вторым заказом значило бы удваивать каждый разъехавшийся.
    active = (
        Order.objects.filter(execution_point=point, status__is_terminal=False)
        .exclude(children__isnull=False)
        .select_related("status")
    )

    new_count = 0
    in_work = 0
    overdue = 0
    sla = effective_sla_minutes(point)
    threshold = timedelta(minutes=sla)
    for order in active:
        if order.status.is_initial:
            new_count += 1
        else:
            in_work += 1
        if local_now - order.created_at >= threshold:
            overdue += 1

    # Отменённые в «сделано» НЕ идут: это про выполненную работу. Отказы важны,
    # но это другое число, и смешивать их значило бы хвалить смену за отмены.
    done_qs = (
        Order.objects.filter(
            execution_point=point,
            status__is_terminal=True,
            status__is_cancelled=False,
            created_at__gte=started_at,
        )
        .exclude(children__isnull=False)
        .only("pk", "created_at", "accepted_at")
    )
    done_orders = list(done_qs)

    # МОМЕНТ ЗАКРЫТИЯ БЕРЁМ ИЗ ЖУРНАЛА ПЕРЕХОДОВ, А НЕ ИЗ `updated_at`.
    #
    # `updated_at` двигает любая правка заказа — комментарий, назначение
    # исполнителя, что угодно после закрытия. Журнал же записывает ровно то, что
    # спрашиваем: когда заказ стал терминальным.
    closed_at: dict = {}
    if done_orders:
        changes = (
            OrderStatusChange.objects.filter(
                order__in=done_orders,
                to_status__is_terminal=True,
                to_status__is_cancelled=False,
            )
            .order_by("order_id", "created_at")
            .values_list("order_id", "created_at")
        )
        # Первое попадание в терминал, а не последнее: заказ туда приходит один
        # раз, но журнал переживает переоткрытия и правки.
        for order_id, moment in changes:
            closed_at.setdefault(order_id, moment)

    durations: list[int] = []
    pickups: list[int] = []
    for order in done_orders:
        moment = closed_at.get(order.pk)
        if moment is not None:
            durations.append(int((moment - order.created_at).total_seconds() // 60))
        if order.accepted_at is not None:
            pickups.append(int((order.accepted_at - order.created_at).total_seconds() // 60))

    return {
        "new": new_count,
        "in_work": in_work,
        "overdue": overdue,
        "done": len(done_orders),
        # Медиана исполнения и медиана реакции. None — «за смену ещё нечего
        # мерить», и экран обязан сказать это словом, а не показать ноль.
        "median_minutes": _median(durations),
        "median_pickup_minutes": _median(pickups),
        "shift_started_at": started_at.isoformat(),
        # Порог, от которого считается `overdue`. Тот же, что на карточках.
        "sla_minutes": sla,
        # Когда была последняя заявка — на пустой доске это единственное, что
        # отличает «затишье» от «экран не работает».
        "last_order_at": _last_order_at(point, hotel),
    }


def _last_order_at(point, hotel) -> str | None:
    last = (
        Order.objects.filter(execution_point=point)
        .exclude(children__isnull=False)
        .order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    return hotel.to_local(last).isoformat() if last else None


def counts_only(point, *, hotel, now=None) -> dict:
    """Совместимый срез для мест, которым нужны только текущие счётчики."""
    summary = shift_summary(point, hotel=hotel, now=now)
    return {key: summary[key] for key in ("new", "in_work", "overdue")}


__all__ = ["shift_summary", "counts_only"]
