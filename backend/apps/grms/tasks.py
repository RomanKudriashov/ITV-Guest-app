"""
Исполнение гостевой команды вне HTTP-запроса.

Здесь живёт то, что раньше жило внутри запроса и делало гостевой путь
невозможным: отправка SET и цикл перечтения feedback длиной до ~4 секунд.
Гость получает ответ немедленно (202 + pending), а сюда уезжает исполнение;
итог возвращается ему WS-каналом комнаты полным снимком.

Задача НАМЕРЕННО без ретраев. Повтор команды в оборудование — это не
«повторить безопасную операцию»: между первой попыткой и второй гость мог
нажать что-то ещё, а шторы, открытые дважды, второй раз открываются уже поверх
чужого решения. Не доехало — гость увидит фактическое состояние и нажмёт сам.
"""

from __future__ import annotations

import logging

from celery import shared_task

from apps.core.context import tenant_context
from apps.grms import commands, inflight

logger = logging.getLogger(__name__)


@shared_task(acks_late=True, max_retries=0, ignore_result=True)
def execute_room_command(
    *,
    hotel_id: str,
    room_id: str,
    control_id: str,
    capability: str,
    value,
    command_id: str,
) -> dict:
    """Отправить команду, дождаться подтверждения, разослать снимок."""
    from apps.hotels.models import Hotel

    hotel = Hotel.objects.filter(pk=hotel_id).first()
    if hotel is None:
        return {"result": commands.RESULT_FAILED, "reason": "hotel_missing"}

    # СТАРЫЕ КОМАНДЫ ПОСЛЕ ВОССТАНОВЛЕНИЯ СВЯЗИ НЕ ВЫПОЛНЯЮТСЯ (ТЗ §6).
    # Запись о команде в полёте живёт ограниченное время; если она исчезла —
    # значит окно прошло, гостю уже показано фактическое состояние, и посылать
    # эту команду сейчас означало бы включить свет в номере, из которого гость
    # десять минут как ушёл.
    entry = inflight.get(hotel_id, room_id, control_id)
    if entry is None or entry.command_id != command_id:
        logger.info("команда %s протухла до исполнения, пропускаем", command_id)
        return {"result": commands.RESULT_UNCONFIRMED, "reason": "expired"}

    try:
        outcome = _execute(hotel, room_id, control_id, capability, value)
    except Exception:  # noqa: BLE001 — конфигурация могла уехать под ногами
        logger.exception("команда %s не выполнена", command_id)
        outcome = {"result": commands.RESULT_FAILED, "error": None, "value": None}
    finally:
        # Элемент освобождается ВСЕГДА: иначе один сбой запирает выключатель
        # в «в процессе» до истечения TTL.
        inflight.finish(hotel_id, room_id, control_id)

    broadcast_room(
        hotel_id,
        room_id,
        event="command",
        command={
            "commandId": command_id,
            "controlId": control_id,
            "result": outcome.get("result"),
        },
    )
    return {"result": outcome.get("result"), "commandId": command_id}


def _execute(hotel, room_id: str, control_id: str, capability: str, value) -> dict:
    from apps.grms.guest import resolve_context
    from apps.hotels.models import Room

    with tenant_context(hotel):
        room = Room.objects.filter(pk=room_id).first()
    if room is None:
        return {"result": commands.RESULT_FAILED, "error": None, "value": None}

    # Резолвим конфигурацию ЗАНОВО, а не тащим технические имена через брокер:
    # так в очереди не лежат `C_*`/`F_*`, а исполняется всегда ТЕКУЩАЯ
    # опубликованная версия, а не та, что была на момент нажатия.
    context, _reason = resolve_context(hotel, _SessionLike(room))
    if context is None:
        return {"result": commands.RESULT_FAILED, "error": None, "value": None}

    control = context.control(control_id)
    if control is None:
        return {"result": commands.RESULT_FAILED, "error": None, "value": None}

    channel = (control.get("channels") or {}).get(capability) or {}
    command_name = channel.get("command") or ""
    if not command_name:
        return {"result": commands.RESULT_FAILED, "error": None, "value": None}

    feedback = channel.get("feedback") or ""
    sent = value
    if capability == "trigger":
        # Что именно отправляет сцена, знает конфигурация: на части объектов
        # сцена активируется нулём, а не единицей.
        trigger_value = channel.get("trigger_value")
        sent = 1 if trigger_value is None else trigger_value
        # У сцены feedback'а не существует — подтверждать нечем, и цикл
        # перечтения для неё не запускается (контракт §6).
        feedback = ""

    outcome = commands.send_command(
        hotel,
        device=context.device,
        channel=command_name,
        value=sent,
        feedback=feedback,
        subdevice=context.payload.get("subdevice") or "",
        room=context.room.number,
    )

    # Схлопывание одновременных чтений сбрасывается СРАЗУ после команды: после
    # неё состояние заведомо другое, и снимок, собранный до неё, отдавать нельзя
    # даже секунду — а именно секунду с небольшим он и жил бы.
    commands.forget_reads(
        hotel,
        context.device,
        [
            channel.get("feedback")
            for control in context.controls
            for channel in (control.get("channels") or {}).values()
            if channel.get("feedback")
        ],
    )
    return outcome


class _SessionLike:
    """
    Минимальный «как сессия» для повторного резолва в воркере.

    У задачи гостевой сессии нет и быть не должно: она исполняет команду
    НОМЕРА, а не человека. Резолв же завязан на `room_id` — единственное, что
    ему от сессии нужно.
    """

    trust = ""
    language = ""
    room_verified_at = None

    def __init__(self, room):
        self.room = room
        self.room_id = room.pk
        self.pk = None


def broadcast_room(hotel_id, room_id, *, event: str, command: dict | None = None) -> None:
    """
    Разбудить все сессии комнаты.

    Сообщение НАМЕРЕННО не несёт состояния: снимок каждый консьюмер собирает
    себе сам. Причина не в экономии, а в двух свойствах, которые иначе теряются:
    снимок локализован языком СВОЕЙ сессии, и право на команды у двух устройств
    в номере может отличаться (одно подтвердило PIN, второе нет).
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        room_group(hotel_id, room_id),
        {"type": "room.event", "event": event, "command": command},
    )


def room_group(hotel_id, room_id) -> str:
    """Группа комнаты — по образцу `order.{hotel}.{order}` (контракт §7)."""
    return f"room.{hotel_id}.{room_id}"
