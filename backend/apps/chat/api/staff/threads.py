"""Треды отеля глазами персонала."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.chat import services as chat_svc
from apps.chat.services import holding
from apps.chat.schemas import MessageIn

router = Router(tags=["tracker-chat"])


# --- Чат (персонал) --------------------------------------------------------


@router.get("/chat/threads", summary="Диалоги отеля — страницей (ресепшен и администратор)")
def staff_threads(request: HttpRequest, cursor: str | None = None, limit: int | None = None):
    return chat_svc.list_threads(cursor=cursor, limit=limit)


@router.get("/chat/threads/{thread_id}", summary="Тред с сообщениями")
def staff_thread(request: HttpRequest, thread_id: str, hold: bool = False):
    """`hold=1` — открыт на рабочем месте: взять свободный или продлить свой."""
    chat_svc.require_chat_access()
    thread = chat_svc.get_thread(thread_id)
    if hold:
        holding.touch(thread, request.user)
    return _staff_snapshot(thread, request.user)


@router.post("/chat/threads/{thread_id}/take", summary="Взять диалог себе (в том числе перехватить)")
def staff_thread_take(request: HttpRequest, thread_id: str):
    chat_svc.require_chat_access()
    thread = chat_svc.get_thread(thread_id)
    holding.touch(thread, request.user, force=True)
    return _staff_snapshot(thread, request.user)


@router.post("/chat/threads/{thread_id}/release", summary="Отпустить свой диалог")
def staff_thread_release(request: HttpRequest, thread_id: str):
    chat_svc.require_chat_access()
    thread = chat_svc.get_thread(thread_id)
    holding.release(thread, request.user)
    return _staff_snapshot(thread, request.user)


def _staff_snapshot(thread, user) -> dict:
    return {**chat_svc.thread_snapshot(thread, side="staff"), "holder": holding.holder_payload(thread, user)}


@router.get("/chat/threads/{thread_id}/guest", summary="Карточка гостя диалога")
def staff_thread_guest(request: HttpRequest, thread_id: str):
    from apps.chat.services.guest_card import guest_card

    chat_svc.require_chat_access()
    return guest_card(chat_svc.get_thread(thread_id))


@router.post("/chat/threads/{thread_id}", summary="Ответить в тред")
def staff_thread_send(request: HttpRequest, thread_id: str, payload: MessageIn):
    chat_svc.require_chat_access()
    thread = chat_svc.get_thread(thread_id)
    chat_svc.staff_send(thread, request.user, payload.body)
    # Ответ в свободном диалоге — взять его; в чужом — держатель не меняется.
    holding.touch(thread, request.user)
    return _staff_snapshot(thread, request.user)


@router.post("/chat/threads/{thread_id}/read", summary="Отметить прочитанными")
def staff_thread_read(request: HttpRequest, thread_id: str):
    chat_svc.require_chat_access()
    thread = chat_svc.get_thread(thread_id)
    chat_svc.mark_read(thread, side="staff")
    return _staff_snapshot(thread, request.user)
