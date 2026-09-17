"""
Главная витрины и уровень заведений.

Главная — это витрина СЕРВИСОВ, и собирает её каталог (`services/showcase.py`,
`services/home.py`). Всё остальное на экране — погода, непрочитанный чат — она
только СПРАШИВАЕТ у соседних доменов готовым ответом: композиция экрана живёт
во вьюхе, а не в чужом сервисе.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.catalog.services.home import home_payload, quick_actions_for
from apps.catalog.services.showcase import build_showcase, list_venues
from apps.chat import services as chat_svc
from apps.core.context import current_language
from apps.core.fields import translate
from apps.integrations.weather import service as weather

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


@router.get("/home", auth=guest_auth, summary="Главная: bento-витрина сервисов отеля")
def guest_home(request: HttpRequest):
    """
    Тело собирает `home_payload` — ТОТ ЖЕ сборщик, которым показ бренда рисует
    главную оператору. Здесь остаётся только то, что знает про гостя: его
    комната и его непрочитанные.
    """
    session = request.guest_session
    return home_payload(
        request.hotel,
        language=current_language(),
        room=session.room.number if session.room_id else None,
        # Счётчик — без треда: главная не заводит пустых переписок.
        unread_chat=chat_svc.unread_for_guest(session),
    )


@router.get("/venues", auth=guest_auth, summary="Уровень 2: заведения группы")
def guest_venues(request: HttpRequest, group: str):
    hotel = request.hotel
    return list_venues(hotel, group, language=current_language(), moment=hotel.local_now())
