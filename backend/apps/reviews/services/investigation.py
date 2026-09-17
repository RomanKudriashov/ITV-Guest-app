"""
Расследование отзыва — всё на одном экране.

Какой заказ, какие заведения, кто вёл каждую часть, сколько шло, была ли
просрочка, срабатывала ли эскалация, что гость писал в чат. Всё, чтобы понять
причину, не ходя по разделам.

ПРОСРОЧКА — ПО СНИМКУ ПОРОГА В ЗАКАЗЕ (`Order.sla_minutes`), а не по
нынешней настройке точки: смена настройки не делает прошлый заказ
просроченным задним числом. Меряется работа — от последнего возврата в работу
(или создания) до закрытия, как и на доске.

ЧАТ — ПЕРЕПИСКА ЭТОГО ГОСТЯ ЗА ВРЕМЯ ЗАКАЗА. Тред принадлежит сессии, а не
заказу: берём сообщения тредов сессии от получаса до заказа (гость мог
спросить заранее) до момента отзыва (жалоба часто приходит после закрытия).
"""

from __future__ import annotations

from datetime import timedelta

from apps.core.fields import translate
from apps.notifications.models import NotificationStatus
from apps.orders.services import status_flows

from apps.reviews.models import Review

CHAT_LEAD = timedelta(minutes=30)


def _minutes(start, end) -> int | None:
    if start is None or end is None:
        return None
    return max(int((end - start).total_seconds() // 60), 0)


def _part(order, hotel, language, names) -> dict:
    point = order.execution_point
    started = order.reopened_at or order.created_at
    work = _minutes(started, order.closed_at)
    sla = order.sla_minutes
    local = hotel.to_local
    escalations = [
        {
            "step": log.step_index,
            "at": local(log.sent_at or log.scheduled_for or log.created_at).isoformat(),
            "status": log.status,
            "target": log.target_kind,
        }
        for log in order.notifications.all()
        if _was_escalation(log)
    ]
    return {
        "order_id": str(order.pk),
        "number": order.number,
        "point": {"id": str(point.pk), "title": translate(point.title, language) or point.code},
        "status": status_flows.status_title(order.status, order.delivery_mode, language),
        "delivery_mode": order.delivery_mode,
        "location": translate(order.location.title, language) if order.location_id else "",
        "assignee": _who_led(order, names),
        "created_at": local(order.created_at).isoformat(),
        "accepted_at": local(order.accepted_at).isoformat() if order.accepted_at else None,
        "closed_at": local(order.closed_at).isoformat() if order.closed_at else None,
        "reopened": order.reopened_at is not None,
        # Реакция — сколько ждали, пока взяли; работа — от взятия в работу
        # (или возврата) до закрытия; всего — сколько ждал гость.
        "reaction_minutes": _minutes(order.created_at, order.accepted_at),
        "work_minutes": work,
        "total_minutes": _minutes(order.created_at, order.closed_at),
        "sla_minutes": sla,
        "overdue_minutes": (work - sla) if (work is not None and sla is not None and work > sla) else 0,
        "was_overdue": bool(work is not None and sla is not None and work > sla),
        "escalations": escalations,
        "history": [
            {
                "title": status_flows.status_title(change.to_status, order.delivery_mode, language),
                "at": local(change.created_at).isoformat(),
                "by": names.get(change.actor_id) if change.actor_id else None,
                "actor_type": change.actor_type,
                "comment": change.comment,
            }
            for change in order.status_changes.all()
        ],
    }


def _was_escalation(log) -> bool:
    """
    Эскалация — ступень, которая СРАБОТАЛА и стояла ПОЗЖЕ создания заказа.

    Ступени ставятся в расписание при создании заказа; погашенные (заказ
    приняли вовремя) и ещё не наступившие эскалацией не были. Нулевая ступень —
    «сразу в чат отдела» о новом заказе — тоже не эскалация. Неудачная
    отправка считается: ступень сработала, до адресата не дошла — это важно
    для разбора.
    """
    if log.parent_id is not None or log.status not in (NotificationStatus.SENT, NotificationStatus.FAILED):
        return False
    if log.step_id is not None and log.step is not None:
        return log.step.delay_minutes > 0
    return log.step_index > 0


def _who_led(order, names) -> str | None:
    """
    Кто вёл: взявший заказ кнопкой «взять», а если так не брали — первый, кто
    сдвинул статус руками. Пусто — заказ двигала только система.
    """
    if order.assignee_id:
        return order.assignee.full_name or order.assignee.email
    for change in order.status_changes.all():
        if change.actor_id and change.actor_id in names:
            return names[change.actor_id]
    return None


def _chat(review: Review, order, hotel) -> list[dict]:
    from apps.chat.models import ChatMessage

    if review.guest_session_id is None:
        return []
    messages = ChatMessage.objects.filter(
        thread__guest_session_id=review.guest_session_id,
        created_at__gte=order.created_at - CHAT_LEAD,
        created_at__lte=review.created_at,
    ).order_by("created_at")
    return [
        {
            "author_type": message.author_type,
            "author": message.author_name,
            "body": message.body,
            "at": hotel.to_local(message.created_at).isoformat(),
        }
        for message in messages[:200]
    ]


def investigation(review_id, language=None) -> dict:
    from apps.accounts.models import User
    from apps.orders.models import Order

    from .reviews import get_cms_review, serialize_cms_review, triage_history

    review = get_cms_review(review_id)
    order = review.order
    hotel = order.hotel

    related = ("execution_point", "status", "location", "assignee")
    prefetch = ("status_changes__to_status", "notifications__step")
    children = list(
        Order.objects.filter(parent_id=order.pk)
        .select_related(*related)
        .prefetch_related(*prefetch)
        .order_by("created_at")
    )
    parts = children or [
        Order.objects.select_related(*related).prefetch_related(*prefetch).get(pk=order.pk)
    ]
    actor_ids = {
        change.actor_id for part in parts for change in part.status_changes.all() if change.actor_id
    }
    names = {
        user.pk: (user.full_name or user.email) for user in User.objects.filter(pk__in=actor_ids)
    }

    lines = []
    from apps.orders.services.services import _order_lines

    for line in _order_lines(order):
        lines.append({"title": translate(line.title_snapshot, language), "quantity": line.quantity})

    return {
        "review": serialize_cms_review(review, language),
        "triage": triage_history(review),
        "order": {
            "id": str(order.pk),
            "number": order.number,
            "room": order.room.number if order.room_id else "",
            "created_at": hotel.to_local(order.created_at).isoformat(),
            "closed_at": hotel.to_local(order.closed_at).isoformat() if order.closed_at else None,
            "total_minutes": _minutes(order.created_at, order.closed_at),
            "total": order.total,
            "currency": order.currency,
            "lines": lines,
            "comment": order.comment,
        },
        "parts": [_part(part, hotel, language, names) for part in parts],
        "chat": _chat(review, order, hotel),
        "chat_window": {
            "from": hotel.to_local(order.created_at - CHAT_LEAD).isoformat(),
            "to": hotel.to_local(review.created_at).isoformat(),
        },
    }
