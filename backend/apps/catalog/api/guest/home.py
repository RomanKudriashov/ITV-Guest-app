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
from apps.catalog.services.home import quick_actions_for
from apps.catalog.services.showcase import build_showcase, list_venues
from apps.chat import services as chat_svc
from apps.core.context import current_language
from apps.core.fields import translate
from apps.integrations.weather import service as weather

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


@router.get("/home", auth=guest_auth, summary="Главная: bento-витрина сервисов отеля")
def guest_home(request: HttpRequest):
    language = current_language()
    hotel = request.hotel

    thread = chat_svc.get_or_create_thread(request.guest_session)
    unread = chat_svc.thread_snapshot(thread, side="guest")["unread"]

    home_settings = (hotel.settings or {}).get("home") or {}

    return {
        "hotel": {
            "name": hotel.name,
            "subdomain": hotel.subdomain,
            # Часовой пояс отеля — чтобы витрина показывала МЕСТНОЕ время и
            # тикала сама, а не спрашивала сервер каждую минуту.
            "timezone": hotel.timezone,
            # Город — подпись к погоде и часам на языке гостя. Пусто — подписи
            # не будет: выдумывать город по координатам мы не станем.
            "city": translate(hotel.city, language),
        },
        "room": request.guest_session.room.number if request.guest_session.room_id else None,
        # Погода приезжает ГОТОВОЙ и только с сервера: адреса провайдера
        # витрина не знает и в него не ходит. `None` — показывать нечего:
        # отель не включал погоду, нет координат, провайдер молчит или значение
        # протухло. Разбираться в причине гостю незачем.
        "weather": weather.current_for(hotel),
        # Показывать ли на главной строку состояния номера. Данные для неё
        # витрина берёт из СВОЕГО существующего снимка номера — второго
        # источника здесь не заводится, отсюда едет только разрешение.
        "room_status": bool(home_settings.get("room_status", True)),
        # Главная — витрина СЕРВИСОВ: bento-плитки заведений/услуг/инфо.
        "tiles": build_showcase(hotel, language=language, moment=hotel.local_now()),
        "unread_chat": unread,
        # Быстрые действия сохраняются для CMS и старых потребителей; новая
        # главная навигирует плитками, отдельный ряд действий не рисует.
        "quick_actions": quick_actions_for(hotel, language),
    }


@router.get("/venues", auth=guest_auth, summary="Уровень 2: заведения группы")
def guest_venues(request: HttpRequest, group: str):
    hotel = request.hotel
    return list_venues(hotel, group, language=current_language(), moment=hotel.local_now())
