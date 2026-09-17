"""
Сервисный слой чата: тред гостя, права персонала, снимок для реконсиляции,
отправка.

Снимок — единый формат для REST и WS, чтобы клиент не собирал состояние из
двух источников. `mine` вычисляется по стороне запроса: одно и то же сообщение
«моё» для его автора и «чужое» для другой стороны.
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError, PermissionDenied, ValidationError
from apps.events.bus import CHAT_MESSAGE, emit

from apps.chat.models import ChatMessage, ChatThread

MAX_BODY = 2000


# --- Тред ------------------------------------------------------------------


def get_or_create_thread(guest_session) -> ChatThread:
    """
    Тред гостя — ТРЕД СЕССИИ, а не номера.

    Раньше тред жил «при номере» и перепривязывался к каждой новой сессии этого
    номера: следующий гость номера 305 открывал чат и видел переписку
    предыдущего — чужие заказы, чужие жалобы, ответ отеля на чужой отзыв
    (проверено: после выезда новый гость читал сообщения прежнего).

    Номер в треде остаётся — персоналу видно, откуда пишут. Старые треды не
    удаляются: они нужны для разбора отзывов, персонал их по-прежнему видит.
    """
    thread = ChatThread.objects.filter(guest_session_id=guest_session.pk).order_by("created_at").first()
    if thread is not None:
        return thread
    return ChatThread.objects.create(
        room_id=guest_session.room_id,
        guest_session=guest_session,
        execution_point=_default_point(),
    )


def _default_point():
    """Куда по умолчанию идёт чат: ресепшн/консьерж, иначе любой отдел."""
    from apps.hotels.models import ExecutionPoint

    return reception_point() or ExecutionPoint.objects.filter(is_active=True).order_by("code").first()


# --- Кто читает чат --------------------------------------------------------


def reception_point():
    """
    Ресепшен отеля — ЯВНАЯ точка с кодом `reception`; нет её — первая по коду
    точка вида «ресепшен». Прежний выбор брал любую точку этого вида, и в
    «Кристалле» чат уходил консьержу (у него тоже вид «ресепшен»).
    """
    from apps.hotels.models import ExecutionPoint

    active = ExecutionPoint.objects.filter(is_active=True)
    return (
        active.filter(code="reception").first()
        or active.filter(kind=ExecutionPoint.Kind.RECEPTION).order_by("code").first()
    )


def can_read_chat(access=None) -> bool:
    """
    ЧАТ ГОСТЕЙ ЧИТАЮТ РЕСЕПШЕН И АДМИНИСТРАТОР — больше никто.

    До волны 9 ручка тредов пускала любого, кто вошёл в трекер: повар и
    горничная читали все переписки отеля со всеми сообщениями. Утечка того же
    класса, что тред «на номер» (волна 8), только шире.
    """
    from apps.accounts.services.roles import current_access

    access = access or current_access()
    if access.unrestricted:
        return True
    point = reception_point()
    return point is not None and str(point.pk) in access.member_point_ids


def require_chat_access() -> None:
    if not can_read_chat():
        raise PermissionDenied(
            "Переписку с гостями ведёт ресепшен", code="chat_forbidden"
        )


def get_thread(thread_id) -> ChatThread:
    thread = ChatThread.objects.filter(pk=thread_id).first()
    if thread is None:
        raise NotFoundError("Тред не найден")
    return thread


# --- Снимок ----------------------------------------------------------------


def thread_snapshot(thread: ChatThread, *, side: str) -> dict:
    """side: 'guest' | 'staff' — от этого зависят `mine` и счётчик непрочитанных."""
    messages = list(thread.messages.all())
    unread = sum(
        1
        for message in messages
        if message.author_type != side
        and (message.read_by_staff_at if side == "staff" else message.read_by_guest_at) is None
    )
    return {
        "thread_id": str(thread.pk),
        "room": thread.room.number if thread.room_id else None,
        "messages": [
            {
                "id": str(message.pk),
                "author_type": message.author_type,
                "author_name": message.author_name or ("Гость" if message.author_type == "guest" else "Персонал"),
                "body": message.body,
                "created_at": message.created_at.isoformat(),
                "mine": message.author_type == side,
            }
            for message in messages
        ],
        "unread": unread,
    }


# --- Отправка --------------------------------------------------------------


def _post_message(thread: ChatThread, *, author_type: str, author_id, author_name: str, body: str) -> ChatMessage:
    body = (body or "").strip()
    if not body:
        raise ValidationError("Пустое сообщение", field="body")
    if len(body) > MAX_BODY:
        raise ValidationError("Слишком длинное сообщение", field="body")

    with transaction.atomic():
        message = ChatMessage.objects.create(
            hotel_id=require_hotel_id(),
            thread=thread,
            author_type=author_type,
            author_id=author_id,
            author_name=author_name[:128],
            body=body,
        )
        ChatThread.objects.filter(pk=thread.pk).update(last_message_at=message.created_at)

    # Событие после коммита: разбудит WS обеих сторон и уведомление получателю.
    emit(
        CHAT_MESSAGE,
        {
            "thread_id": str(thread.pk),
            "message_id": str(message.pk),
            "author_type": author_type,
            "room": thread.room.number if thread.room_id else "",
            "execution_point_id": str(thread.execution_point_id) if thread.execution_point_id else "",
            "preview": body[:120],
        },
        hotel_id=thread.hotel_id,
        actor_type=author_type,
        actor_id=author_id,
    )
    return message


def guest_send(guest_session, body: str) -> dict:
    thread = get_or_create_thread(guest_session)
    _post_message(thread, author_type="guest", author_id=guest_session.pk, author_name="Гость", body=body)
    return thread_snapshot(thread, side="guest")


def staff_send(thread: ChatThread, user, body: str) -> dict:
    name = user.full_name or user.email
    _post_message(thread, author_type="staff", author_id=user.pk, author_name=name, body=body)
    return thread_snapshot(thread, side="staff")


# --- Прочитано -------------------------------------------------------------


def mark_read(thread: ChatThread, *, side: str) -> None:
    now = timezone.now()
    other = "staff" if side == "guest" else "guest"
    field = "read_by_guest_at" if side == "guest" else "read_by_staff_at"
    thread.messages.filter(author_type=other, **{f"{field}__isnull": True}).update(**{field: now})


# --- Персонал: список тредов -----------------------------------------------


THREADS_PAGE = 30
THREADS_PAGE_MAX = 100


def list_threads(*, cursor: str | None = None, limit: int | None = None) -> dict:
    """
    Диалоги отеля — страницей, свежие сверху.

    Пустые треды в список не попадают: их заводит сама витрина, а персоналу
    читать нечего. Листание курсором: новые сообщения поднимают диалог наверх
    прямо во время просмотра, и смещение показало бы часть страницы дважды.
    `unread_total` — по всем диалогам, а не по странице: его показывает значок.
    """
    require_chat_access()
    page_size = max(1, min(int(limit or THREADS_PAGE), THREADS_PAGE_MAX))
    unread_filter = Q(messages__author_type="guest", messages__read_by_staff_at__isnull=True)
    base = ChatThread.objects.filter(last_message_at__isnull=False)
    queryset = (
        base.select_related("room")
        .annotate(unread=Count("messages", filter=unread_filter))
        .order_by("-last_message_at", "-pk")
    )
    if cursor:
        at, _, cursor_id = cursor.partition("|")
        moment = parse_datetime(at.replace(" ", "+")) if at else None
        if moment is None or not cursor_id:
            raise ValidationError("Неверный курсор", field="cursor", code="bad_cursor")
        queryset = queryset.filter(
            Q(last_message_at__lt=moment) | Q(last_message_at=moment, pk__lt=cursor_id)
        )
    last_body = ChatMessage.objects.filter(thread=OuterRef("pk")).order_by("-created_at").values("body")[:1]
    rows = list(queryset.annotate(last_body=Subquery(last_body))[: page_size + 1])
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    unread_total = ChatMessage.objects.filter(
        author_type="guest", read_by_staff_at__isnull=True
    ).count()
    return {
        "items": [
            {
                "thread_id": str(thread.pk),
                "room": thread.room.number if thread.room_id else None,
                "last_body": (thread.last_body or "")[:120],
                "last_at": thread.last_message_at.isoformat(),
                "unread": thread.unread,
            }
            for thread in rows
        ],
        "next_cursor": (
            f"{rows[-1].last_message_at.isoformat()}|{rows[-1].pk}" if has_more and rows else None
        ),
        "unread_total": unread_total,
    }
