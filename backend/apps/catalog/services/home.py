"""
Быстрые действия стартовой.

Словарь ФИКСИРОВАН и выведен из реальных разделов витрины (не выдуман): меню,
услуги, брони, инфо, чат. Отель выбирает и упорядочивает набор в CMS; хранится
в `hotel.settings["quick_actions"]` — новой таблицы не нужно. По умолчанию —
реально наполненные разделы + чат, чтобы стартовая не была пустой.
"""

from __future__ import annotations

from apps.core.fields import translate

# code → (route витрины, иконка Material Symbols, тип оффера для проверки
# наличия раздела; None — всегда доступен).
QUICK_ACTION_VOCAB = [
    {"code": "menu", "route": "/menu", "icon": "restaurant", "type": "product"},
    {"code": "services", "route": "/services", "icon": "room_service", "type": "service_request"},
    {"code": "slots", "route": "/slots", "icon": "event_available", "type": "slot"},
    {"code": "info", "route": "/info", "icon": "info", "type": "info"},
    {"code": "chat", "route": "/chat", "icon": "chat", "type": None},
]
QUICK_ACTION_CODES = {entry["code"] for entry in QUICK_ACTION_VOCAB}
_BY_CODE = {entry["code"]: entry for entry in QUICK_ACTION_VOCAB}

# Заголовки — фолбэк для не-фронтовых потребителей; витрина рендерит свои i18n.
_TITLES = {
    "menu": {"ru": "Заказать в номер", "en": "Order to room", "ar": "الطلب إلى الغرفة", "zh": "客房送餐"},
    "services": {"ru": "Услуги", "en": "Services", "ar": "الخدمات", "zh": "服务"},
    "slots": {"ru": "Бронирование", "en": "Booking", "ar": "الحجز", "zh": "预订"},
    "info": {"ru": "Об отеле", "en": "About the hotel", "ar": "عن الفندق", "zh": "酒店信息"},
    "chat": {"ru": "Написать в отель", "en": "Message the hotel", "ar": "مراسلة الفندق", "zh": "联系酒店"},
}


def _present_codes() -> list[str]:
    """Коды разделов, реально наполненных у отеля (+ всегда доступные)."""
    from apps.catalog.models import Category

    present_types = set(Category.objects.filter(is_active=True).values_list("type", flat=True))
    return [
        entry["code"]
        for entry in QUICK_ACTION_VOCAB
        if entry["type"] is None or entry["type"] in present_types
    ]


def available_quick_actions() -> list[dict]:
    """Полный словарь для CMS."""
    return [
        {"code": e["code"], "route": e["route"], "icon": e["icon"], "title": _TITLES.get(e["code"], {})}
        for e in QUICK_ACTION_VOCAB
    ]


def selected_codes(hotel) -> list[str]:
    configured = (hotel.settings or {}).get("quick_actions")
    if not configured:
        return _present_codes()
    # Только валидные коды словаря, порядок отеля.
    return [code for code in configured if code in QUICK_ACTION_CODES]


def quick_actions_for(hotel, language: str | None = None) -> list[dict]:
    """Плитки стартовой: набор отеля или дефолт по наличию разделов."""
    out = []
    for code in selected_codes(hotel):
        entry = _BY_CODE[code]
        out.append(
            {
                "code": code,
                "route": entry["route"],
                "icon": entry["icon"],
                "title": translate(_TITLES.get(code, {}), language),
            }
        )
    return out


def validate_codes(codes) -> list[str]:
    """Валидация выбора CMS: все коды из словаря, дубли убираем, порядок хранится."""
    from apps.core.errors import ValidationError

    seen = []
    for code in codes or []:
        if code not in QUICK_ACTION_CODES:
            raise ValidationError(
                f"Неизвестное быстрое действие «{code}»", field="selected", code="unknown_quick_action"
            )
        if code not in seen:
            seen.append(code)
    return seen


def home_payload(hotel, *, language: str, room: str | None, unread_chat: int) -> dict:
    """
    ГЛАВНАЯ ГОСТЯ — ОДНИМ СБОРЩИКОМ НА ДВУХ ПОТРЕБИТЕЛЕЙ.

    Зовут отсюда двое: гостевая ручка `/guest/home` и показ витрины в настройке
    бренда. Раньше тело лежало во вьюхе, и показать оператору главную можно было
    только одним способом — собрать её на клиенте руками. Так и было сделано:
    показ рисовал свою верхнюю треть из четырёх компонентов, и любая новая
    полоса на настоящей главной в него не попадала.

    ОТ СЕССИИ ЗДЕСЬ ЗАВИСЯТ РОВНО ДВЕ ВЕЩИ, и обе приходят доводами: номер
    комнаты и счётчик непрочитанных в чате. Всё остальное — свойства отеля, и
    гостю с оператором показывается ОДНО И ТО ЖЕ, посчитанное одним кодом.
    """
    from apps.catalog.services.showcase import build_showcase
    from apps.core.fields import translate
    from apps.integrations.weather import service as weather

    home_settings = (hotel.settings or {}).get("home") or {}

    return {
        "hotel": {
            "name": hotel.name_i18n,
            "subdomain": hotel.subdomain,
            # Часовой пояс отеля — чтобы витрина показывала МЕСТНОЕ время и
            # тикала сама, а не спрашивала сервер каждую минуту.
            "timezone": hotel.timezone,
            # Город — подпись к погоде и часам на языке гостя. Пусто — подписи
            # не будет: выдумывать город по координатам мы не станем.
            "city": translate(hotel.city, language),
        },
        "room": room,
        # Погода приезжает ГОТОВОЙ и только с сервера: адреса провайдера
        # витрина не знает и в него не ходит. `None` — показывать нечего.
        "weather": weather.current_for(hotel),
        # Показывать ли на главной строку состояния номера. Данные для неё
        # витрина берёт из своего снимка номера — отсюда едет только разрешение.
        "room_status": bool(home_settings.get("room_status", True)),
        # Главная — витрина СЕРВИСОВ: bento-плитки заведений/услуг/инфо.
        "tiles": build_showcase(hotel, language=language, moment=hotel.local_now()),
        "unread_chat": unread_chat,
        # Быстрые действия сохраняются для CMS и старых потребителей; новая
        # главная навигирует плитками, отдельный ряд действий не рисует.
        "quick_actions": quick_actions_for(hotel, language),
    }
