"""
Карточка гостя на рабочем месте ресепшена.

То, ради чего место отдельное: ресепшен отвечает, зная контекст, а не
переспрашивая. Номер, язык, что сейчас готовится, что было за проживание,
оставлял ли гость низкую оценку.

ПРОЖИВАНИЕ БЕЗ PMS. Заезда и выезда мы не знаем. Честная граница, какая
есть, — отметка выезда ресепшеном (`check_out_room` гасит сессии номера):
проживание — сессии номера, открытые ПОСЛЕ последнего выезда, плюс сессия
самого диалога. Без номера (гость по ссылке) — только его сессия.
"""

from __future__ import annotations

from django.db.models import Max

from apps.core.context import current_language
from apps.core.fields import translate

HISTORY_LIMIT = 20


def stay_session_ids(thread) -> list:
    from apps.accounts.models import GuestSession

    ids = {thread.guest_session_id} if thread.guest_session_id else set()
    if thread.room_id:
        sessions = GuestSession.objects.filter(room_id=thread.room_id)
        last_checkout = sessions.aggregate(at=Max("revoked_at"))["at"]
        if last_checkout is not None:
            sessions = sessions.filter(created_at__gt=last_checkout)
        ids |= set(sessions.values_list("pk", flat=True))
    return [pk for pk in ids if pk]


def _order_row(order, language, hotel) -> dict:
    from apps.orders.services import status_flows
    from apps.orders.services.services import _order_summary

    point = order.execution_point
    return {
        "id": str(order.pk),
        "number": order.number,
        "status": {
            "code": order.status.code,
            "title": status_flows.status_title(order.status, order.delivery_mode, language),
            "color_token": order.status.color_token,
            "is_terminal": order.status.is_terminal,
            "is_cancelled": order.status.is_cancelled,
        },
        "point": translate(point.title, language) or point.code,
        "delivery_mode": order.delivery_mode,
        "created_at": hotel.to_local(order.created_at).isoformat(),
        "total": order.total,
        "currency": order.currency,
        **_order_summary(order, language),
    }


def guest_card(thread) -> dict:
    from apps.orders.models import Order
    from apps.reviews.models import Review

    language = current_language()
    hotel = thread.hotel
    session = thread.guest_session
    stay = stay_session_ids(thread)

    orders = (
        Order.objects.filter(guest_session_id__in=stay, parent__isnull=True)
        .select_related("status", "execution_point")
        .order_by("-created_at")
    )
    active = [o for o in orders.filter(status__is_terminal=False)]
    past = list(orders.filter(status__is_terminal=True)[:HISTORY_LIMIT])
    past_total = orders.filter(status__is_terminal=True).count()

    reviews = list(
        Review.objects.filter(order__guest_session_id__in=stay)
        .select_related("order")
        .order_by("-created_at")
    )
    low = [r for r in reviews if r.is_low]

    from apps.accounts.models import GuestSession

    first = (
        GuestSession.objects.filter(pk__in=stay).order_by("created_at").values_list("created_at", flat=True).first()
    )
    # Задачи, переданные отделам из ЭТОГО диалога: ресепшен видит, что с ними
    # стало, не выходя из переписки (переписка остаётся у него).
    tasks = (
        Order.objects.filter(source_thread_id=thread.pk)
        .select_related("status", "execution_point")
        .order_by("-created_at")[:HISTORY_LIMIT]
    )
    return {
        "room": thread.room.number if thread.room_id else None,
        "tasks": [
            {**_order_row(order, language, hotel), "comment": order.comment}
            for order in tasks
        ],
        "language": (session.language or "") if session is not None else "",
        "room_verified": bool(session is not None and session.room_verified_at),
        "reachable": bool(
            session is not None and session.revoked_at is None and session.expires_at > _now()
        ),
        "stay_since": hotel.to_local(first).isoformat() if first else None,
        "active_orders": [_order_row(o, language, hotel) for o in active],
        "history": [_order_row(o, language, hotel) for o in past],
        "history_total": past_total,
        "had_low_review": bool(low),
        "low_reviews": [
            {
                "id": str(r.pk),
                "rating": r.rating,
                "comment": r.comment[:200],
                "order_number": r.order.number,
                "triage": r.triage_status,
                "at": hotel.to_local(r.created_at).isoformat(),
            }
            for r in low
        ],
        "reviews_count": len(reviews),
    }


def _now():
    from django.utils import timezone

    return timezone.now()
