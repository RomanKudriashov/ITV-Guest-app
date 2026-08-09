"""Тред гостя: чтение, отправка, отметка прочитанного."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.auth import GuestAuth
from apps.chat import services as chat_svc
from apps.chat.schemas import MessageIn

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


# --- Чат (гость) -----------------------------------------------------------


@router.get("/chat", auth=guest_auth, summary="Тред гостя")
def guest_chat(request: HttpRequest):
    thread = chat_svc.get_or_create_thread(request.guest_session)
    return chat_svc.thread_snapshot(thread, side="guest")


@router.post("/chat", auth=guest_auth, summary="Отправить сообщение")
def guest_chat_send(request: HttpRequest, payload: MessageIn):
    return chat_svc.guest_send(request.guest_session, payload.body)


@router.post("/chat/read", auth=guest_auth, summary="Отметить прочитанными")
def guest_chat_read(request: HttpRequest):
    thread = chat_svc.get_or_create_thread(request.guest_session)
    chat_svc.mark_read(thread, side="guest")
    return chat_svc.thread_snapshot(thread, side="guest")
