"""
CMS: кто может управлять номером — PIN проживания и демо-вход.

Раздел закрыт МОДУЛЕМ `room_control`, а не только ролью: калитка
`services/access.hotel_with_module()` стоит на входе каждого эндпоинта, а не на
экране. Без неё отель без модуля дотянулся бы до оборудования запросом мимо
интерфейса.

Гостю здесь ничего не появляется: маршруты живут под `/api/v1/cms`, куда
гостевой токен не пускают в принципе (роутер закрыт `CmsAuth`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.grms.schemas.cms import DemoEntryIn, PinIn
from apps.core.errors import NotFoundError
from apps.core.models import AuditLog
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])


# --- Доступ гостя: PIN проживания и демо-вход -------------------------------






# Текст, который администратор обязан увидеть рядом с переключателем. Живёт на
# сервере, а не в вёрстке: послабление продуктовое, и формулировка не должна
# зависеть от того, какой экран его показывает.
DEMO_ENTRY_WARNING = (
    "Демо-вход ОСЛАБЛЯЕТ доступ к управлению номером: подтвердить номер можно "
    "будет без PIN проживания, по одному лишь номеру комнаты. Включать только "
    "на время демонстрации."
)


@router.get("/grms/access", summary="Кто может управлять номером: PIN и демо-вход")
def access_state(request: HttpRequest):
    """
    Показывает и состояние демо-входа, и у каких номеров заведён PIN.

    Сам PIN не возвращается никогда — в базе лежит только хэш. Ресепшен видит
    код в момент заведения, а не «посмотреть, какой там был».
    """
    from apps.grms.services import access as access_svc
    from apps.grms.services.guest import demo_entry_enabled

    hotel = hotel_with_module()
    rooms = access_svc.list_room_pins(hotel)
    return {
        "demo_entry": {
            "enabled": demo_entry_enabled(hotel),
            "warning": DEMO_ENTRY_WARNING,
            # Послабление живёт, пока его не выключат, — значит вопрос «кто это
            # включил и когда» задают неделю спустя, и ответ должен быть на
            # экране, а не в журнале платформы.
            "toggled": access_svc.last_demo_entry_toggle(hotel),
        },
        "pins": rooms,
    }


@router.post("/grms/access/pin", summary="Завести или снять PIN проживания номера")
def set_room_pin(request: HttpRequest, payload: PinIn):
    """
    PIN виден ресепшену ровно один раз — в момент заведения его назвал сам
    администратор. Смена PIN сбрасывает подтверждение у всех устройств этой
    комнаты: именно этим отмечается смена гостя, пока нет выезда по PMS.
    """
    from apps.grms.services import access as access_svc
    from apps.grms.services import pin as room_pin

    hotel = hotel_with_module()
    room = access_svc.find_room(hotel, payload.room_number)
    if room is None:
        raise NotFoundError(f"Номер «{payload.room_number}» не найден")

    if not payload.pin:
        room_pin.clear_pin(hotel, room)
        return {"room": room.number, "has_pin": False}

    record = room_pin.set_pin(hotel, room, pin=payload.pin)
    return {"room": room.number, "has_pin": True, "issued_at": record.issued_at}


@router.post("/grms/access/demo-entry", summary="Демо-вход без PIN (временное послабление)")
def set_demo_entry(request: HttpRequest, payload: DemoEntryIn):
    """
    ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ MVP, а не штатное поведение. Выключено по умолчанию.

    Ослабляет РОВНО step-up: резолв по-прежнему идёт из сессии, чужой номер
    по-прежнему недостижим, тело команды по-прежнему `{controlId, value}`.
    Каждый вход без PIN пишется в журнал отдельным событием.
    """
    from apps.grms.services import access as access_svc

    hotel = hotel_with_module()
    access_svc.set_demo_entry(hotel, payload.enabled)

    AuditLog.record(
        "grms.demo_entry_toggled",
        actor_type=AuditLog.ActorType.STAFF,
        actor_id=getattr(request.user, "pk", None),
        object_type="grms.hotel",
        object_id=hotel.pk,
        payload={"enabled": bool(payload.enabled)},
        hotel_id=hotel.pk,
    )
    return {"enabled": bool(payload.enabled), "warning": DEMO_ENTRY_WARNING}
