"""Настройка чата отеля: сколько гость ждёт ответа до сигнала."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.errors import ValidationError
from apps.hotels.services.hotel import current_hotel

from apps.chat.schemas import ChatSettingsIn

router = Router(tags=["cms:chat"])

MIN_MINUTES = 1
MAX_MINUTES = 240


def _payload(hotel) -> dict:
    return {"reply_wait_minutes": hotel.chat_reply_minutes}


@router.get("/chat-settings", summary="Порог ожидания ответа в чате")
def get_settings(request: HttpRequest):
    require_hotel_admin()
    return _payload(current_hotel())


@router.patch("/chat-settings", summary="Изменить порог ожидания")
def patch_settings(request: HttpRequest, payload: ChatSettingsIn):
    """
    Порог — политика отеля: у курорта и у хостела разный темп. Ноль запрещён:
    «мгновенно» означало бы сигнал на каждое сообщение гостя.
    """
    require_hotel_admin()
    hotel = current_hotel()
    if payload.reply_wait_minutes is not None:
        value = int(payload.reply_wait_minutes)
        if not MIN_MINUTES <= value <= MAX_MINUTES:
            raise ValidationError(
                f"Порог — от {MIN_MINUTES} до {MAX_MINUTES} минут",
                field="reply_wait_minutes",
                code="bad_reply_wait",
            )
        hotel.chat_reply_minutes = value
        hotel.save(update_fields=["chat_reply_minutes", "updated_at"])
    return _payload(hotel)
