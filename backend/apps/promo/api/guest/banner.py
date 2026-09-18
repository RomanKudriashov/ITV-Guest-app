"""
Баннер для витрины — ОТДЕЛЬНОЙ РУЧКОЙ, а не полем главной.

Это не вкусовщина, а требование «на медленном соединении баннер не должен
задерживать витрину». Лежи он в теле `/guest/home`, гость ждал бы рекламу,
чтобы увидеть меню, — и чем хуже канал, тем дольше. Отдельным запросом
витрина рисуется сразу, а баннер появляется, когда придёт; не пришёл — не
показываем, и это нормальное состояние экрана, а не дыра.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.core.context import current_language

from apps.promo.services import showing
from apps.promo.services.serializers import guest_payload

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


@router.get("/banner", auth=guest_auth, summary="Баннер витрины: один или ничего")
def guest_banner(request: HttpRequest):
    """
    ОДИН баннер на экран, не больше. Показ отмечается здесь же и ровно один
    раз на сессию — иначе CTR считал бы перерисовки.
    """
    session = request.guest_session
    language = current_language()
    banner = showing.pick_for(request.hotel, session, language=language)
    if banner is None:
        return {"banner": None}
    showing.record_view(banner, session, language=language)
    return {"banner": guest_payload(banner, language=language)}


@router.post("/banner/{banner_id}/click", auth=guest_auth, summary="Гость нажал баннер")
def guest_banner_click(request: HttpRequest, banner_id: str):
    view = showing.record_click(banner_id, request.guest_session)
    return {"ok": view is not None}


@router.post("/banner/{banner_id}/close", auth=guest_auth, summary="Гость закрыл баннер")
def guest_banner_close(request: HttpRequest, banner_id: str):
    """Закрытый баннер не возвращается в этой сессии — состояние на сервере."""
    return {"ok": showing.dismiss(banner_id, request.guest_session)}
