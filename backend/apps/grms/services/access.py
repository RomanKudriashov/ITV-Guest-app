"""
Калитка раздела: отель запроса плюс проверка модуля.

Жила приватной функцией во вьюхе `api/cms/grms.py`. Проверка стоит на входе
КАЖДОГО эндпоинта, а не на экране: без неё отель без модуля дотянулся бы до
оборудования запросом мимо интерфейса.

Класс ошибки и её текст перенесены дословно — ответ эндпоинта не изменился.
"""

from __future__ import annotations

from apps.core.context import require_hotel_id
from apps.core.errors import DomainError

from apps.hotels.models import Hotel, HotelModule
from apps.hotels.module_registry import enabled_module_codes


class ModuleDisabled(DomainError):
    status = 403
    code = "module_disabled"


def hotel_with_module() -> Hotel:
    hotel = Hotel.objects.get(pk=require_hotel_id())
    if HotelModule.Code.ROOM_CONTROL not in enabled_module_codes(hotel):
        raise ModuleDisabled("Модуль «Управление номером» не подключён")
    return hotel


def set_demo_entry(hotel: Hotel, enabled: bool) -> bool:
    """
    Переключить демо-вход без PIN. Перенос дословный из вьюхи; запись в журнал
    осталась во вьюхе — она знает актора.
    """
    from apps.core.context import tenant_context
    from apps.core.errors import NotFoundError

    with tenant_context(hotel):
        module = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL).first()
        if module is None:
            raise NotFoundError("Модуль «Управление номером» не подключён")
        config = dict(module.config or {})
        config["guest_entry_demo"] = bool(enabled)
        module.config = config
        module.save(update_fields=["config", "updated_at"])
    return bool(enabled)


def last_demo_entry_toggle(hotel: Hotel) -> dict | None:
    """
    Кто и когда последним трогал демо-вход. `None` — не трогали ни разу.

    Читаем из журнала, а не заводим поля на модуле: событие
    `grms.demo_entry_toggled` пишется с самого начала, и второй источник правды
    о том же факте разошёлся бы с первым при первой же правке мимо API.

    Имя актора резолвим здесь: экран показывает человека, а `actor_id` — это
    UUID, который человеку не говорит ничего.
    """
    from apps.accounts.models import User
    from apps.core.models import AuditLog

    entry = (
        AuditLog.all_objects.filter(hotel_id=hotel.pk, action="grms.demo_entry_toggled")
        .order_by("-created_at")
        .first()
    )
    if entry is None:
        return None

    actor = User.all_objects.filter(pk=entry.actor_id).first() if entry.actor_id else None
    return {
        "enabled": bool((entry.payload or {}).get("enabled")),
        "at": entry.created_at.isoformat(),
        # Удалённый сотрудник не должен превращать запись в пустую строку:
        # «кто-то из персонала» честнее, чем ничего.
        "by": (actor.full_name or actor.email) if actor else "",
    }


def list_room_pins(hotel: Hotel) -> list[dict]:
    """У каких номеров заведён PIN. Сам PIN не возвращается никогда — в базе хэш."""
    from apps.core.context import tenant_context

    from apps.grms.models import RoomPin

    with tenant_context(hotel):
        return [
            {
                "room": record.room.number,
                "issued_at": record.issued_at,
                "valid_until": record.valid_until,
                "is_active": record.is_active,
            }
            for record in RoomPin.objects.select_related("room").order_by("room__number")
        ]


def find_room(hotel: Hotel, number: str):
    from apps.core.context import tenant_context

    from apps.hotels.models import Room

    with tenant_context(hotel):
        return Room.objects.filter(number=number).first()


class NotOurs(DomainError):
    """Действие нашей пусконаладки, а не отеля."""

    status = 403
    code = "platform_only"


def ours_only(user) -> Hotel:
    """
    Калитка для действий, которые выполняем МЫ, а не отель.

    Уровень плана — платная услуга: отель её не выбирает и не меняет. Проверка
    стоит на СЕРВЕРЕ, а не на экране: спрятанный, но живой контрол — это то, что
    мы уже ловили, когда экран не показывал, а запрос проходил.

    Модуль проверяется тем же порядком: без него оборудования у отеля нет вовсе,
    и говорить об уровнях не о чем.
    """
    hotel = hotel_with_module()
    if not getattr(user, "is_platform_admin", False):
        raise NotOurs(
            "Уровень плана задаёт платформа: это часть услуги, а не настройка отеля"
        )
    return hotel
