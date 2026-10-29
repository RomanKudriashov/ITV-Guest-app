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


@router.get("/weather/cities", auth=guest_auth, summary="Поиск города для экрана погоды (подсказки DaData)")
def guest_weather_cities(request: HttpRequest, q: str = ""):
    """
    Только города, по всему миру. `available: false` — поиск не настроен (нет
    ключа). `cities: null` — провайдер не ответил, это не «ничего не найдено».
    """
    from apps.integrations.geo import dadata

    return {"available": dadata.available(), "cities": dadata.suggest_cities(q[:64], current_language())}


@router.get("/weather", auth=guest_auth, summary="Подробная погода отеля: сейчас, по часам, дни, месяцы, море, воздух")
def guest_weather(request: HttpRequest, lat: float | None = None, lon: float | None = None, name: str = ""):
    """
    Экран погоды гостя (партия 65). Данные — только из кэша: собирает их фоновая
    задача, гость провайдера не ждёт. `pending` — погода включена, но ещё едет:
    экран переспрашивает. Погода у отеля выключена — `enabled: false`.
    """
    hotel = request.hotel
    from apps.integrations.geo import dadata

    point = weather.point_of(lat, lon) if lat is not None and lon is not None else None
    if point is not None:
        # Город, найденный гостем: погода точки в единицах отеля. Название —
        # то, что гость выбрал в подсказке; сервер его не переводит.
        detail, pending = weather.detail_for_point(point, getattr(hotel, "temperature_units", "c"))
        return {
            "enabled": True,
            "pending": pending,
            "city": name[:80],
            "timezone": "",
            "weather": detail,
            "search": dadata.available(),
            "point": {"latitude": point[0], "longitude": point[1]},
        }
    detail, pending = weather.detail_for(hotel)
    return {
        "search": dadata.available(),
        "point": None,
        "enabled": weather.is_enabled(hotel),
        "pending": pending,
        "city": translate(hotel.city, current_language()),
        "timezone": hotel.timezone,
        "weather": detail,
    }


@router.get("/venues", auth=guest_auth, summary="Уровень 2: заведения группы")
def guest_venues(request: HttpRequest, group: str):
    hotel = request.hotel
    return list_venues(hotel, group, language=current_language(), moment=hotel.local_now())
