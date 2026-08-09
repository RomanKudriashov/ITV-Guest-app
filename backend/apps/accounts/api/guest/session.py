"""
Гостевая сессия. Контракт — docs/guest-api-contract.md.

ЛОГИКА ДОВЕРИЯ НЕ ЗДЕСЬ: вьюха разбирает запрос и зовёт сервис. Уровни доверия
и их проверки живут в apps/accounts.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.schemas.guest import GuestSessionIn, GuestSessionOut, RoomNotFoundOut
from apps.accounts.services import AuthenticationFailed, create_guest_session
from apps.accounts.services.auth import GuestAuth
from apps.core.context import current_language
from apps.hotels.services.brand_payload import serialize_hotel

router = Router(tags=["guest"])
guest_auth = GuestAuth()


def _session_payload(session, hotel, *, token: str | None = None) -> dict:
    return {
        "token": token,
        "session_id": str(session.pk),
        "trust": session.trust,
        "expires_at": session.expires_at,
        "language": session.language or hotel.default_language,
        "room": session.room.number if session.room_id else None,
        "hotel": serialize_hotel(hotel),
    }


@router.post(
    "/session",
    response={200: GuestSessionOut, 404: RoomNotFoundOut},
    auth=None,
    summary="Создать гостевую сессию (QR или ручной ввод номера)",
)
def create_session(request: HttpRequest, payload: GuestSessionIn):
    hotel = request.hotel
    try:
        issued = create_guest_session(
            room_number=payload.room_number,
            language=payload.language or current_language() or "",
            user_agent=request.headers.get("User-Agent", ""),
        )
    except AuthenticationFailed as exc:
        # Отсканирован старый QR или опечатка при вводе — не «ошибка сервера»,
        # а развилка сценария. Отдаём бренд, чтобы экран остался фирменным.
        return 404, {
            "detail": str(exc),
            "code": "room_not_found",
            "hint": "manual_entry",
            "hotel": serialize_hotel(hotel),
        }

    return 200, _session_payload(issued.session, hotel, token=issued.token)


@router.get(
    "/session", response=GuestSessionOut, auth=guest_auth, summary="Текущая сессия"
)
def read_session(request: HttpRequest):
    return _session_payload(request.guest_session, request.hotel)
