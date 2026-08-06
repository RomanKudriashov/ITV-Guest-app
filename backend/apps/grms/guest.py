"""
Гостевая сторона управления номером: резолв, снапшот, приём команды.

Главное правило контракта (contracts/guest-api.md): фронт знает про `controlId`
и значение, и больше ни про что. Номер комнаты, имя устройства iRidi, `C_*`,
`F_*`, `subdevice`, `requestID` — всё это выводится ЗДЕСЬ из гостевой сессии и
наружу не уходит. Подмена `controlId` в запросе даёт максимум «такого элемента
в вашем номере нет»: комната берётся из сессии, а не из тела запроса, и
дотянуться до соседней ей нечем.

Второе правило, ради которого написана половина этого файла: УСТАРЕВШЕЕ НЕ
ПОКАЗЫВАЕТСЯ КАК ТЕКУЩЕЕ. Когда связи нет, элементы уходят в `offline` БЕЗ
значений, а не остаются с последним известным состоянием. Гость, которому
показали «шторы открыты» на мёртвом канале, поверит экрану, а не окну.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from apps.core.context import tenant_context
from apps.core.errors import ConflictError, NotFoundError, PermissionDenied, ValidationError
from apps.core.fields import translate
from apps.core.models import AuditLog
from apps.grms import catalog, commands, inflight, liveness, transport
from apps.grms import plan as plan_geometry
from apps.grms.models import PublishedConfig, RoomTypeRoom

logger = logging.getLogger(__name__)

AVAILABILITY_ONLINE = "online"
AVAILABILITY_UNAVAILABLE = "unavailable"

STATE_CONFIRMED = "confirmed"
STATE_PENDING = "pending"
STATE_OFFLINE = "offline"

# Технические причины недоступности. Гостю НЕ показываются (контракт §3) —
# живут в журнале и в логах, чтобы инженер мог ответить «почему не работало».
REASON_NO_ROOM = "NO_ROOM"
REASON_NO_TYPE = "NO_ROOM_TYPE"
REASON_NO_CONFIG = "NO_PUBLISHED_CONFIG"
REASON_NODE_OFFLINE = "CONNECTOR_OFFLINE"
REASON_ENDPOINT_UNREACHABLE = "ENDPOINT_UNREACHABLE"
REASON_UNREADABLE = "STATE_UNREADABLE"
REASON_FEEDBACK_DEAD = "FEEDBACK_DEAD"

# Ровно текст ТЗ §6. Локализуем здесь, а не на фронте: гостевой API отдаёт
# строки уже локализованными (заголовки элементов — так же).
_UNAVAILABLE_TEXT = {
    "ru": "Управление номером временно недоступно. Пожалуйста, обратитесь на ресепшен.",
    "en": "Room control is temporarily unavailable. Please contact the reception desk.",
    "ar": "التحكم في الغرفة غير متاح مؤقتًا. يرجى التواصل مع مكتب الاستقبال.",
    "zh": "客房控制暂时不可用。请联系前台。",
}

# Ключ значения внутри составного элемента. Совпадает с именем capability
# везде, кроме toggle: в контракте у кондиционера это `on`.
_VALUE_KEY = {"toggle": "on"}


class RoomControlUnavailable(ConflictError):
    """Легальное состояние «управлять сейчас нечем», а не отказ системы."""

    code = "room_unavailable"


@dataclass(frozen=True)
class RoomContext:
    hotel: object
    room: object
    room_type_code: str
    payload: dict
    device: str

    @property
    def controls(self) -> list[dict]:
        return [
            control
            for zone in self.payload.get("zones", [])
            for control in zone.get("controls", [])
        ]

    def control(self, control_id: str) -> dict | None:
        return next((c for c in self.controls if c.get("controlId") == control_id), None)


# --- Резолв ----------------------------------------------------------------


def module_enabled(hotel) -> bool:
    """
    Модуль отеля. Выключен — раздела не существует, и это 403, а не пустой
    экран: маршрут обязан быть закрыт на СЕРВЕРЕ, иначе гейт живёт только в
    бандле и снимается инструментами разработчика.
    """
    from apps.hotels.models import HotelModule
    from apps.hotels.module_registry import enabled_module_codes

    return HotelModule.Code.ROOM_CONTROL in enabled_module_codes(hotel)


def require_module(hotel) -> None:
    if not module_enabled(hotel):
        raise PermissionDenied("Раздел недоступен", code="module_disabled")


def resolve_context(hotel, session) -> tuple[RoomContext | None, str]:
    """
    Сессия → комната → тип → ТЕКУЩАЯ опубликованная версия.

    Возвращает (контекст, причина отсутствия). Отсутствие звена — не ошибка, а
    легальное `unavailable` (контракт §1): комнату могли не привязать к типу, а
    тип — не опубликовать, и гость об этом узнавать не должен.
    """
    if session is None or session.room_id is None:
        return None, REASON_NO_ROOM

    with tenant_context(hotel):
        link = (
            RoomTypeRoom.objects.select_related("room_type", "room")
            .filter(room_id=session.room_id)
            .first()
        )
        if link is None:
            return None, REASON_NO_TYPE

        config = (
            PublishedConfig.objects.filter(room_type=link.room_type, is_current=True)
            .only("payload", "room_type_id")
            .first()
        )
        if config is None or not (config.payload or {}).get("zones"):
            return None, REASON_NO_CONFIG

        device = link.device_name_override or (
            (link.room_type.device_name_template or "").replace("{room}", link.room.number)
        )
        if not device:
            return None, REASON_NO_TYPE

        return (
            RoomContext(
                hotel=hotel,
                room=link.room,
                room_type_code=link.room_type.code,
                payload=config.payload or {},
                device=device,
            ),
            "",
        )


# --- Доверие ---------------------------------------------------------------


def demo_entry_enabled(hotel) -> bool:
    """
    ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ MVP, не штатное поведение.

    Разрешает подтверждение по одному лишь номеру комнаты, без PIN. Выключено
    по умолчанию; включается администратором в конфигурации модуля. Ослабляет
    РОВНО step-up и ничего больше: резолв по-прежнему идёт из сессии, чужой
    номер по-прежнему недостижим, тело команды по-прежнему `{controlId, value}`.
    """
    from apps.hotels.models import HotelModule

    with tenant_context(hotel):
        module = HotelModule.objects.filter(
            code=HotelModule.Code.ROOM_CONTROL, is_enabled=True
        ).first()
    return bool(module and (module.config or {}).get("guest_entry_demo") is True)


def can_command(hotel, session) -> bool:
    """
    Право отправлять команды.

    Уровень `pms_verified` под это НЕ занимается: PMS-интеграции нет, и когда
    она появится, этот уровень обязан означать реальную сверку с PMS. Признак
    подтверждения по PIN живёт отдельным полем сессии.
    """
    if session is None or session.room_id is None:
        return False
    if session.room_verified_at is not None:
        return True
    return demo_entry_enabled(hotel)


def _note_demo_entry(hotel, session) -> None:
    """
    Вход без PIN — отдельное событие журнала, один раз на сессию.

    Один раз, а не на каждый снапшот: иначе событие, которое должно бросаться в
    глаза при разборе, утонет в собственных повторах.
    """
    from django.core.cache import cache

    key = f"grms:demo_entry:{session.pk}"
    if not cache.add(key, 1, 24 * 3600):
        return
    with tenant_context(hotel):
        AuditLog.record(
            "grms.demo_entry",
            actor_type=AuditLog.ActorType.GUEST,
            object_type="grms.session",
            object_id=session.pk,
            payload={
                "room": session.room.number if session.room_id else "",
                "note": "доступ без PIN: включён демо-вход отеля",
            },
            hotel_id=hotel.pk,
        )


# --- Снапшот ---------------------------------------------------------------


def build_state(hotel, session, *, language: str = "") -> dict:
    """
    Полный снапшот состояния номера. Частичных апдейтов в контракте нет.

    Порядок обязателен (контракт §4): проверить узел и endpoint → прочитать
    feedback'и пачкой → собрать. Если проверка не прошла, чтение НЕ делается:
    ждать таймаутов по каждому каналу, зная, что слушать некому, значит держать
    гостя на скелетоне ради заведомо известного ответа.
    """
    require_module(hotel)
    context, reason = resolve_context(hotel, session)
    allowed = can_command(hotel, session)
    if allowed and session is not None and session.room_verified_at is None:
        _note_demo_entry(hotel, session)

    if context is None:
        return _unavailable(session, reason, language=language, allowed=allowed)

    reason = _link_reason(hotel)
    if reason:
        return _unavailable(session, reason, language=language, allowed=allowed, context=context)

    readings, dead = _read_state(context)
    if dead:
        # Все каналы ответили булевым `false`: на стенде без поднятого обмена с
        # GRMS так выглядят ВСЕ теги. «Всё выключено» и «нам никто не отвечает»
        # в этой картине неразличимы, и показать первое значит соврать.
        return _unavailable(
            session, REASON_FEEDBACK_DEAD, language=language, allowed=allowed, context=context
        )

    return {
        "availability": AVAILABILITY_ONLINE,
        "message": None,
        "checked_at": _now_iso(),
        "trust": session.trust if session else "anonymous",
        "can_command": allowed,
        "zones": _serialize_zones(context, readings, language=language),
        **_plan(context),
    }


def _plan(context: RoomContext | None) -> dict:
    """
    План-двойник: картинка и геометрия. КОНФИГУРАЦИЯ, а не состояние.

    Поэтому он отдаётся и в недоступности тоже: разметка комнаты не перестаёт
    быть верной оттого, что каналы молчат. Врал бы не план, а свет на нём —
    но света в недоступном снимке нет: зоны пустые, значений нет ни у одного
    элемента, и рисовать по ним нечего.

    Плана нет — ключа нет вовсе. Тип без плана обязан работать списком, а не
    получать пустую рамку и заглушку вместо кадра.
    """
    if context is None:
        return {}
    with tenant_context(context.hotel):
        plan = plan_geometry.for_guest(context.payload.get("plan"))
    return {"plan": plan} if plan else {}


def _link_reason(hotel) -> str:
    """Узел и endpoint — до всякого чтения."""
    if not transport.node_is_online(hotel):
        return REASON_NODE_OFFLINE
    # None — «узел ещё не присылал heartbeat с пробами». Это НЕ отказ:
    # коннектор, подключившийся секунду назад, просто не успел. Реальную
    # недоступность поймает чтение, и элементы уйдут в offline честно.
    if liveness.endpoint_reachable(hotel.pk) is False:
        return REASON_ENDPOINT_UNREACHABLE
    return ""


def _read_state(context: RoomContext) -> tuple[dict, bool]:
    """
    Прочитать все feedback'и типа. Возвращает ({feedback: результат}, «мёртв ли стенд»).
    """
    feedbacks = sorted(
        {
            channel.get("feedback")
            for control in context.controls
            for channel in (control.get("channels") or {}).values()
            if channel.get("feedback")
        }
    )
    if not feedbacks:
        return {}, False

    results = commands.read_many(
        context.hotel,
        device=context.device,
        feedbacks=list(feedbacks),
        subdevice=context.payload.get("subdevice") or "",
        room=context.room.number,
    )
    successful = [result for result in results.values() if result.ok]
    dead = bool(successful) and all(result.is_dead_sentinel for result in successful)
    return results, dead


def _unavailable(session, reason: str, *, language: str, allowed: bool, context=None) -> dict:
    """
    Недоступность. Гость получает нейтральный текст, техническая причина — в лог.

    Зоны отдаются ПУСТЫМИ, а не с последними известными значениями: элемент без
    связи не имеет состояния, и «показать что было» здесь означает показать
    неправду.
    """
    logger.info("управление номером недоступно: причина=%s", reason)
    return {
        "availability": AVAILABILITY_UNAVAILABLE,
        "message": translate(_UNAVAILABLE_TEXT, language),
        "checked_at": _now_iso(),
        "trust": session.trust if session else "anonymous",
        "can_command": allowed,
        "zones": [],
        **_plan(context),
    }


def _serialize_zones(context: RoomContext, readings: dict, *, language: str) -> list[dict]:
    hotel_id, room_id = context.hotel.pk, context.room.pk
    busy = inflight.active_controls(
        hotel_id, room_id, [c.get("controlId") for c in context.controls]
    )
    zones = []
    for zone in context.payload.get("zones", []):
        controls = [
            _serialize_control(control, readings, busy=busy, language=language)
            for control in zone.get("controls", [])
        ]
        zones.append(
            {
                "code": zone.get("code") or "",
                "title": translate(zone.get("title"), language),
                "controls": controls,
            }
        )
    return zones


def _serialize_control(control: dict, readings: dict, *, busy: dict, language: str) -> dict:
    """
    Элемент БЕЗ технических полей.

    Из снимка конфигурации сюда переносится только то, что перечислено в
    контракте §5 реестра элементов: controlId, kind, title, capabilities, value,
    range, state, readonly. `channels` (command/feedback/subdevice/trigger_value)
    не переносится ни целиком, ни по кускам — это карта того, какая команда в
    какое железо уходит, и гостю она не принадлежит.
    """
    control_id = control.get("controlId") or ""
    capabilities = list(control.get("capabilities") or [])
    channels = control.get("channels") or {}
    ranges = control.get("range") or {}

    values: dict[str, object] = {}
    unreadable = False
    for capability in capabilities:
        feedback = (channels.get(capability) or {}).get("feedback")
        if not feedback:
            # trigger: состояния нет и быть не может — подтверждать нечем.
            continue
        result = readings.get(feedback)
        if result is None or result.failed or result.is_dead_sentinel:
            unreadable = True
            continue
        values[_VALUE_KEY.get(capability, capability)] = result.value

    entry = busy.get(control_id)
    if entry is not None:
        state = STATE_PENDING
    elif unreadable:
        state = STATE_OFFLINE
    else:
        state = STATE_CONFIRMED

    serialized: dict[str, object] = {
        "controlId": control_id,
        "kind": control.get("kind") or "",
        "title": translate(control.get("title"), language),
        # Глиф и подписи состояния — ЛОКАЛИЗОВАННЫЕ и готовые. Фронт не
        # придумывает слова за элемент: «Блэкаут открыта» получалось именно
        # так, а у трёх сцен был один значок, потому что различить их без
        # разбора controlId он не мог.
        "icon": control.get("icon") or "",
        # Короткая подпись карточки («всё готово ко сну») — локализованная и
        # готовая, как и подписи состояний.
        "hint": translate(control.get("hint"), language),
        "labels": {
            key: translate(text, language)
            for key, text in (control.get("states") or {}).items()
        },
        "capabilities": capabilities,
        "value": _value_for(capabilities, values, state),
        "state": state,
        "readonly": _is_readonly(capabilities),
    }
    exposed = _ranges_for(capabilities, ranges)
    if exposed:
        serialized["range"] = exposed
    return serialized


def _value_for(capabilities: list[str], values: dict, state: str):
    """
    Составной элемент — ОДИН controlId с объектом-значением, а не четыре
    независимых: иначе фронт собирал бы фанкойл из кусков, зная, что фанкойл из
    чего-то состоит.

    В `offline` и `pending` значения не отдаются вовсе.
    """
    if state != STATE_CONFIRMED or not values:
        return None
    if len(capabilities) == 1:
        return next(iter(values.values()))
    return values


def _is_readonly(capabilities: list[str]) -> bool:
    """Элемент только для чтения, если ни одной записываемой ручки нет."""
    writable = [
        code
        for code in capabilities
        if not catalog.CAPABILITIES.get(code, None) or not catalog.CAPABILITIES[code].readonly
    ]
    return not writable


def _ranges_for(capabilities: list[str], ranges: dict) -> dict:
    """
    Диапазоны отдаём только там, где они что-то значат для отрисовки.

    Для `toggle`/`trigger` «0..1» фронту не нужен: он и так рисует
    переключатель. Для уставки и скорости — обязателен, потому что 16, 32 и 3
    НЕ зашиты на фронте и приезжают из переменных типа.
    """
    exposed = {}
    for capability in capabilities:
        entry = ranges.get(capability) or {}
        if entry.get("kind") == catalog.ValueKind.BINARY:
            continue
        if "min" not in entry or "max" not in entry:
            continue
        exposed[capability] = {"min": entry["min"], "max": entry["max"], "step": 1}
    return exposed


def _now_iso() -> str:
    from django.utils import timezone

    return timezone.now().isoformat()


# --- Команда ---------------------------------------------------------------


def submit_command(hotel, session, *, control_id: str, capability: str = "", value=None) -> dict:
    """
    Принять команду и вернуться НЕМЕДЛЕННО.

    Синхронного пути здесь нет и быть не может: подтверждение — это цикл
    перечтения feedback длиной до ~4 секунд (commands.CONFIRM_DELAYS_S), и
    держать на нём HTTP-ответ гостю значит показывать ему замерший экран на всё
    это время. Ответ 202 означает «принято», а не «оборудование в этом
    состоянии»: сам iRidi на SET подтверждает только приём (ТЗ §12).

    Исполнение и подтверждение уходят в воркер, итог возвращается WS-каналом
    комнаты полным снимком.
    """
    require_module(hotel)
    if not can_command(hotel, session):
        raise PermissionDenied(
            "Подтвердите, что вы в номере", code="trust_required"
        )

    context, reason = resolve_context(hotel, session)
    if context is None:
        raise RoomControlUnavailable(_neutral_unavailable(session), code="room_unavailable")

    control = context.control(control_id)
    if control is None:
        # Ровно то, что обещает контракт подмене controlId: «такого элемента в
        # вашем номере нет». Комната взята из сессии, дотянуться до соседней
        # этим запросом нечем.
        raise NotFoundError("Такого элемента в вашем номере нет", code="control_unknown")

    capability = _resolve_capability(control, capability)
    sent_value = _validate_value(control, capability, value)

    link_reason = _link_reason(hotel)
    if link_reason:
        raise RoomControlUnavailable(_neutral_unavailable(session), code="room_unavailable")

    entry = inflight.begin(
        hotel.pk, context.room.pk, control_id, capability=capability, value=sent_value
    )
    if entry is None:
        # Повторный тап, пока команда в полёте. Вторую задачу не создаём:
        # «дробью» гость набил бы очередь в оборудование.
        raise ConflictError(
            "Предыдущее действие ещё выполняется", code="command_in_flight"
        )

    from apps.grms.tasks import execute_room_command

    execute_room_command.delay(
        hotel_id=str(hotel.pk),
        room_id=str(context.room.pk),
        control_id=control_id,
        capability=capability,
        value=sent_value,
        command_id=entry.command_id,
    )
    return {"commandId": entry.command_id, "controlId": control_id, "state": STATE_PENDING}


def _neutral_unavailable(session) -> str:
    language = (session.language if session else "") or ""
    return translate(_UNAVAILABLE_TEXT, language)


def _resolve_capability(control: dict, capability: str) -> str:
    """
    У составного элемента ручек несколько, у простого — одна, и тогда поле
    в запросе опускается (контракт §5).
    """
    capabilities = list(control.get("capabilities") or [])
    writable = [
        code
        for code in capabilities
        if code in catalog.CAPABILITIES and not catalog.CAPABILITIES[code].readonly
    ]
    if not capability:
        if len(writable) != 1:
            raise ValidationError(
                "Не указано, что именно менять", field="capability", code="capability_required"
            )
        return writable[0]
    if capability not in capabilities:
        raise NotFoundError("Такого элемента в вашем номере нет", code="control_unknown")
    spec = catalog.CAPABILITIES.get(capability)
    if spec is not None and spec.readonly:
        # Текущая температура приходит только по feedback: команд на неё нет.
        raise ValidationError(
            "Это значение только для чтения", field="capability", code="readonly_capability"
        )
    return capability


def _validate_value(control: dict, capability: str, value):
    """
    Значение проверяется на СЕРВЕРЕ по диапазону из переменной типа номера.

    `26` для скорости вентилятора (диапазон 0–3) отбивается здесь, а не
    «как-нибудь» доезжает до Modbus.
    """
    if capability == "trigger":
        # У сцены значения нет: что именно отправить, знает конфигурация
        # (trigger_value), а не гость.
        return None

    entry = (control.get("range") or {}).get(capability) or {}
    kind = entry.get("kind") or catalog.ValueKind.BINARY
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(
            "Недопустимое значение", field="value", code="value_out_of_range"
        ) from None

    low = entry.get("min", 0 if kind == catalog.ValueKind.BINARY else None)
    high = entry.get("max", 1 if kind == catalog.ValueKind.BINARY else None)
    if low is not None and number < low:
        raise ValidationError("Недопустимое значение", field="value", code="value_out_of_range")
    if high is not None and number > high:
        raise ValidationError("Недопустимое значение", field="value", code="value_out_of_range")
    return number
