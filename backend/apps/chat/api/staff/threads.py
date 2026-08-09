"""Треды отеля глазами персонала."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.chat import services as chat_svc
from apps.chat.schemas import MessageIn

router = Router(tags=["tracker-chat"])


# --- Чат (персонал) --------------------------------------------------------


@router.get("/chat/threads", summary="Треды отеля")
def staff_threads(request: HttpRequest):
    return chat_svc.list_threads()


@router.get("/chat/threads/{thread_id}", summary="Тред с сообщениями")
def staff_thread(request: HttpRequest, thread_id: str):
    thread = chat_svc.get_thread(thread_id)
    return chat_svc.thread_snapshot(thread, side="staff")


@router.post("/chat/threads/{thread_id}", summary="Ответить в тред")
def staff_thread_send(request: HttpRequest, thread_id: str, payload: MessageIn):
    thread = chat_svc.get_thread(thread_id)
    return chat_svc.staff_send(thread, request.user, payload.body)


@router.post("/chat/threads/{thread_id}/read", summary="Отметить прочитанными")
def staff_thread_read(request: HttpRequest, thread_id: str):
    thread = chat_svc.get_thread(thread_id)
    chat_svc.mark_read(thread, side="staff")
    return chat_svc.thread_snapshot(thread, side="staff")
