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
