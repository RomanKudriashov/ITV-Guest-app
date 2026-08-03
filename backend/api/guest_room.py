"""
Гостевой API управления номером. Контракт — docs/grms/contracts/guest-api.md.

Отдельный файл, а не строки в `api/guest.py`: у раздела свой гейт (модуль
отеля), свой step-up (PIN проживания) и своё правило про технические поля.
Смешав его с витриной, мы получили бы файл, в котором «что можно отдать гостю»
решается по-разному в соседних функциях.

Все 14 маршрутов GRMS под `/cms` остаются на месте и здесь не участвуют: там
CmsAuth и конструктор конфигурации, тут гостевой токен и `{controlId, value}`.

Вьюхи тонкие: разобрать запрос, позвать сервис, отдать результат. Вся логика —
в `apps/grms/guest.py` и `apps/grms/pin.py`, доменные ошибки превращает в HTTP
общий обработчик (`api/__init__.py`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

from apps.accounts.auth import GuestAuth
from apps.core.context import current_language

router = Router(tags=["guest-room"])
guest_auth = GuestAuth()


class VerifyIn(Schema):
    pin: str


class CommandIn(Schema):
    controlId: str
    # Нужен только составным элементам: у кондиционера четыре ручки под одним
    # controlId. Для простых опускается.
    capability: str = ""
    value: int | None = None


@router.get("/room/state", auth=guest_auth, summary="Состояние номера (полный снапшот)")
def room_state(request: HttpRequest):
    """
    Полный снимок. Частичных апдейтов в контракте нет: гость открывает страницу
    в произвольный момент, и склеивать дельты ему не из чего.
    """
    from apps.grms import guest as room_guest

    return room_guest.build_state(
        request.hotel, request.guest_session, language=current_language()
    )


@router.post(
    "/room/command",
    response={202: dict},
    auth=guest_auth,
    summary="Отправить команду (принимается немедленно, подтверждение — каналом)",
)
def room_command(request: HttpRequest, payload: CommandIn):
    """
    202, а не 200, и это не косметика: `status:"true"` от iRidi означает лишь,
    что команда ПРИНЯТА, а не что оборудование в этом состоянии (ТЗ §12).
    Подтверждение приходит отдельно, снимком по WS.
    """
    from apps.grms import guest as room_guest

    return 202, room_guest.submit_command(
        request.hotel,
        request.guest_session,
        control_id=payload.controlId,
        capability=payload.capability or "",
        value=payload.value,
    )


@router.post(
    "/room/verify",
    auth=guest_auth,
    summary="Подтвердить PIN проживания (step-up для команд)",
)
def room_verify(request: HttpRequest, payload: VerifyIn):
    """
    Ошибки отдаёт сервисный слой: 401 `PIN_INVALID` с `attempts_left`, 429
    `PIN_THROTTLED` с `retry_after_s`. Ответ константного времени — без
    подсказок, чем именно не подошёл код.
    """
    from apps.grms import guest as room_guest
    from apps.grms.pin import verify

    room_guest.require_module(request.hotel)
    return verify(request.hotel, request.guest_session, pin=payload.pin)
