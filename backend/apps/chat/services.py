"""
Сервисный слой чата: тред на номер, снимок для реконсиляции, отправка.

Снимок — единый формат для REST и WS, чтобы клиент не собирал состояние из
двух источников. `mine` вычисляется по стороне запроса: одно и то же сообщение
«моё» для его автора и «чужое» для другой стороны.
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError, ValidationError
from apps.events.bus import CHAT_MESSAGE, emit

from .models import ChatMessage, ChatThread

MAX_BODY = 2000


# --- Тред ------------------------------------------------------------------


def get_or_create_thread(guest_session) -> ChatThread:
    """
    Тред гостя: по номеру, если он есть, иначе по сессии. Один активный тред на
    номер — переписка не дробится между заездами и переоформлениями.
    """
    if guest_session.room_id:
        thread = ChatThread.objects.filter(room_id=guest_session.room_id).order_by("created_at").first()
        if thread is not None:
            # Привязываем текущую сессию, чтобы WS гостя нашёл свой тред.
            if thread.guest_session_id != guest_session.pk:
                ChatThread.objects.filter(pk=thread.pk).update(guest_session=guest_session)
                thread.guest_session_id = guest_session.pk
            return thread
        return ChatThread.objects.create(
            room_id=guest_session.room_id,
            guest_session=guest_session,
            execution_point=_default_point(),
        )

    thread = ChatThread.objects.filter(guest_session_id=guest_session.pk).first()
    if thread is not None:
        return thread
    return ChatThread.objects.create(guest_session=guest_session, execution_point=_default_point())


def _default_point():
    """Куда по умолчанию идёт чат: ресепшн/консьерж, иначе любой отдел."""
    from apps.hotels.models import ExecutionPoint

    reception = ExecutionPoint.objects.filter(
        kind=ExecutionPoint.Kind.RECEPTION, is_active=True
    ).first()
    return reception or ExecutionPoint.objects.filter(is_active=True).order_by("code").first()


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


def list_threads() -> list[dict]:
    threads = ChatThread.objects.select_related("room").prefetch_related("messages").order_by(
        "-last_message_at", "-created_at"
    )
    result = []
    for thread in threads:
        messages = list(thread.messages.all())
        if not messages:
            continue
        last = messages[-1]
        unread = sum(1 for m in messages if m.author_type == "guest" and m.read_by_staff_at is None)
        result.append(
            {
                "thread_id": str(thread.pk),
                "room": thread.room.number if thread.room_id else None,
                "last_body": last.body[:120],
                "last_at": last.created_at.isoformat(),
                "unread": unread,
            }
        )
    return result
