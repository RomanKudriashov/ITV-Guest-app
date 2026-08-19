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
from apps.grms.transport import transport
from apps.grms.services import catalog, commands, inflight, liveness
from apps.grms.services import plan as plan_geometry
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
# Устройство КОМНАТЫ молчит подтверждённо. Отдельная причина от
# `ENDPOINT_UNREACHABLE`: та про весь объект и приходит от коннектора, эта —
# про одну комнату и выясняется чтением. Слив их в одну, мы и получали отель,
# погашенный одной мёртвой комнатой.
REASON_DEVICE_SILENT = "DEVICE_SILENT"

# Ровно текст ТЗ §6. Локализуем здесь, а не на фронте: гостевой API отдаёт
# строки уже локализованными (заголовки элементов — так же).
_UNAVAILABLE_TEXT = {
    "ru": "Управление номером временно недоступно. Пожалуйста, обратитесь на ресепшен.",
    "en": "Room control is temporarily unavailable. Please contact the reception desk.",
    "ar": "التحكم في الغرفة غير متاح مؤقتًا. يرجى التواصل مع مكتب الاستقبال.",
    "zh": "客房控制暂时不可用。请联系前台。",
}

# ВИД НЕДОСТУПНОСТИ — то, что гостю ПОКАЗЫВАТЬ, а не то, что технически
# случилось. Технические причины (`REASON_*`) по-прежнему не выходят наружу
# (контракт §3): наружу выходит ответ на вопрос «что мне сейчас делать».
#
# Три вида, потому что действий ровно три и они разные:
#   `reading`  — подождать, экран сам перечитает;
#   `offline`  — идти на ресепшен, само не починится;
#   `no_room`  — назвать номер комнаты, дальше всё заработает.
# До этого все три отвечали «обратитесь на ресепшен», включая случай, когда
# гость просто не сказал, в каком он номере.
UNAVAILABLE_READING = "reading"
UNAVAILABLE_OFFLINE = "offline"
UNAVAILABLE_NO_ROOM = "no_room"

_READING_TEXT = {
    "ru": "Читаем состояние номера…",
    "en": "Reading the room state…",
    "ar": "جارٍ قراءة حالة الغرفة…",
    "zh": "正在读取客房状态…",
}

_NO_ROOM_TEXT = {
    "ru": "Введите номер комнаты, чтобы управлять ею.",
    "en": "Enter your room number to control the room.",
    "ar": "أدخل رقم غرفتك للتحكم بها.",
    "zh": "请输入房间号以控制客房。",
}

# Причина → что показать. Не перечисленное считается отказом: новый REASON_*
# обязан попасть сюда осознанно, а не унаследовать «подождите» по умолчанию.
_UNAVAILABLE_KIND = {
    REASON_NO_ROOM: UNAVAILABLE_NO_ROOM,
    REASON_UNREADABLE: UNAVAILABLE_READING,
    # DEVICE_SILENT сюда не вписан намеренно: подтверждённое молчание — это
    # честный отказ (`offline`), как и молчание всего канала. Разница между
    # ними в ОБЛАСТИ (комната против отеля), а не в том, что видит гость.
}

_KIND_TEXT = {
    UNAVAILABLE_READING: _READING_TEXT,
    UNAVAILABLE_NO_ROOM: _NO_ROOM_TEXT,
    UNAVAILABLE_OFFLINE: _UNAVAILABLE_TEXT,
}

# Сколько подряд молчащих чтений считать «ещё читаем», прежде чем назвать это
# отказом. Два: первое молчание неотличимо от холодного старта коннектора,
# второе — уже свидетельство. Больше двух держать гостя на «читаем состояние»
# нечестно: каждая попытка стоит до `commands.READ_BUDGET_S` реального
# ожидания, и на третьей подпись перестаёт быть правдой.
COLD_READ_ATTEMPTS = 2

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


def room_verified(hotel, session) -> bool:
    """
    ГОСТЬ ПОДТВЕРДИЛСЯ, ЧТО ОН В НОМЕРЕ. Про оборудование здесь не сказано ничего.

    Функция звалась `can_command`, и это имя склеивало два разных «нельзя».
    Ответ на вопрос «доверяем ли мы этому гостю» не зависит от того, отвечает
    ли сейчас железо, и наоборот: подтверждённому гостю нельзя скомандовать
    молчащему фанкойлу, а неподтверждённому нельзя скомандовать исправному.
    Снимок теперь несёт оба ответа порознь (`room_verified` и `can_command`).

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
    verified = room_verified(hotel, session)
    if verified and session is not None and session.room_verified_at is None:
        _note_demo_entry(hotel, session)

    if context is None:
        return _unavailable(session, reason, language=language, verified=verified)

    reason = _link_reason(hotel)
    if reason:
        return _unavailable(session, reason, language=language, verified=verified, context=context)

    readings, read_reason = _read_state(context)
    if read_reason:
        # Либо все каналы ответили булевым `false` (на стенде без поднятого
        # обмена с GRMS так выглядят ВСЕ теги: «всё выключено» и «нам никто не
        # отвечает» в этой картине неразличимы, и показать первое значит
        # соврать), либо не ответил ни один.
        return _unavailable(
            session, read_reason, language=language, verified=verified, context=context
        )

    return {
        "availability": AVAILABILITY_ONLINE,
        "message": None,
        "unavailable_kind": None,
        "checked_at": _now_iso(),
        "trust": session.trust if session else "anonymous",
        # ДВА РАЗНЫХ ОТВЕТА, а не один на два вопроса.
        "room_verified": verified,
        # Оборудование ответило — значит командовать можно ровно тому, кому
        # мы доверяем.
        "can_command": verified,
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


def _room_is_silent(context: RoomContext) -> bool:
    """Комната признана молчащей и ещё не пора перепроверять."""
    return liveness.room_is_silent(
        context.hotel.pk,
        context.room.pk,
        attempts=COLD_READ_ATTEMPTS,
        coalesce_s=commands.READ_COALESCE_S,
    )


def _read_state(context: RoomContext) -> tuple[dict, str]:
    """
    Прочитать все feedback'и типа.

    Возвращает ({feedback: результат}, причина недоступности) — пустая строка
    означает «состояние прочитано».

    Различаются ЧЕТЫРЕ исхода, а не два. Раньше их было два, и третий — самый
    частый в аварии — молча попадал в «всё хорошо»:

    * прочитали → пусто;
    * ответили, но все ответы — булев `false` → FEEDBACK_DEAD;
    * не ответил ни один ВПЕРВЫЕ → STATE_UNREADABLE («ещё читаем»);
    * не ответил ни один СНОВА → ENDPOINT_UNREACHABLE («связи нет»).

    Прежний код считал `dead = bool(successful) and all(...)`. Когда связи
    нет, `successful` пуст, `dead` выходил False — и функция возвращала
    «состояние прочитано» на пачке сплошных таймаутов. Экран номера показывал
    гостю рабочую комнату с шестью зонами и нулём значений, а до порога
    heartbeat (три минуты) поймать это было больше нечем: узел всё ещё
    числится живым, потому что три минуты назад он и был живым.

    ПОЧЕМУ ПЕРВОЕ МОЛЧАНИЕ — ОТДЕЛЬНЫЙ ИСХОД. Оно неотличимо от «коннектор
    поднялся секунду назад и ещё не успел отдать значения»: узел числится
    живым, endpoint про себя ничего не сообщал, а канал молчит. Объявлять по
    одному такому чтению отказ с отправкой на ресепшен — это отправлять гостя
    вниз из-за задержки, которая пройдёт сама через секунду. Второе подряд
    молчание уже не совпадение, и вот оно и есть отказ.
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
        return {}, ""

    # Комната уже признана молчащей и перепроверять её ещё рано — не платим
    # за таймауты по каждому каналу ради ответа, который только что получили.
    # Это ровно та экономия, ради которой раньше портили ОБЩИЙ признак живости;
    # теперь она действует на одну комнату и соседей не задевает.
    if _room_is_silent(context):
        return {}, REASON_DEVICE_SILENT

    results = commands.read_many(
        context.hotel,
        device=context.device,
        feedbacks=list(feedbacks),
        subdevice=context.payload.get("subdevice") or "",
        room=context.room.number,
    )
    successful = [result for result in results.values() if result.ok]

    if not successful:
        # Молчание ЭТОЙ комнаты. Первое — ещё не приговор, повторное — факт.
        silent, silent_for = liveness.note_silent_read(context.hotel.pk, context.room.pk)
        proven = silent >= COLD_READ_ATTEMPTS and silent_for >= commands.READ_COALESCE_S
        if not proven:
            # ХОЛОДНОЕ ЧТЕНИЕ: экран переспросит сам, отказа пока нет.
            return results, REASON_UNREADABLE

        # Молчит не первый раз и достаточно долго, чтобы повтор дошёл до
        # железа. Это отказ — но отказ КОМНАТЫ.
        #
        # Здесь стоял `liveness.observe(hotel, False)`, и это была самая
        # дорогая строка файла: она записывала молчание одной комнаты в
        # признак живости ОТЕЛЯ, а `_link_reason` читает его на всех. Один
        # гость, открывший номер без оборудования, гасил соседям исправные
        # номера — те даже не доходили до чтения. Утверждение «до объекта не
        # достучаться» вправе делать только коннектор своим heartbeat: он
        # один видит канал целиком.
        return results, REASON_DEVICE_SILENT

    # Прочитали — молчания ЭТОЙ комнаты больше ничего не значат. Заодно
    # подтверждаем живость канала: раз ответило одно устройство, endpoint жив,
    # и это уже законное утверждение про весь отель.
    liveness.forget_silent_reads(context.hotel.pk, context.room.pk)
    liveness.observe(context.hotel.pk, True)

    if all(result.is_dead_sentinel for result in successful):
        return results, REASON_FEEDBACK_DEAD
    return results, ""


def _unavailable(session, reason: str, *, language: str, verified: bool, context=None) -> dict:
    """
    Недоступность. Техническая причина остаётся в логе, наружу идёт ВИД.

    Зоны отдаются ПУСТЫМИ, а не с последними известными значениями: элемент без
    связи не имеет состояния, и «показать что было» здесь означает показать
    неправду.

    ДВА ФЛАГА, ДВА РАЗНЫХ «НЕЛЬЗЯ».

    `can_command` здесь ВСЕГДА False: недоступному оборудованию нельзя отдать
    команду никому, сколь угодно доверенному. А `room_verified` — ответ на
    совсем другой вопрос, «доверяем ли мы этому гостю», и он от молчания
    железа не меняется.

    Раньше поле было одно, и экран читал по нему обе вещи сразу. Отсюда и
    брался укус: гость вводил верный PIN, оборудование в этот момент молчало,
    снимок приезжал с `can_command: false` — и экран показывал ему замок
    заново, как будто PIN не подошёл. Подтверждение при этом на сервере было.
    """
    kind = _UNAVAILABLE_KIND.get(reason, UNAVAILABLE_OFFLINE)
    logger.info("управление номером недоступно: причина=%s вид=%s", reason, kind)
    return {
        "availability": AVAILABILITY_UNAVAILABLE,
        "message": translate(_KIND_TEXT[kind], language),
        "unavailable_kind": kind,
        "checked_at": _now_iso(),
        "trust": session.trust if session else "anonymous",
        "room_verified": verified,
        "can_command": False,
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
    # Проверка ДОВЕРИЯ, а не готовности железа: молчащее оборудование отобьёт
    # команду ниже, ответом `room_unavailable`, и путать эти два отказа нельзя —
    # первый лечится PIN, второй ресепшеном.
    if not room_verified(hotel, session):
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

    # Устройство ЭТОЙ комнаты подтверждённо молчит — команду принимать некуда.
    # Проверка отдельная от `_link_reason`, потому что и факты разные: там
    # «до объекта не достучаться», здесь «объект жив, а эта комната глухая».
    # Без неё команда уходила бы в воркер и возвращалась исходом `failed`
    # через несколько секунд — принято в никуда вместо честного отказа сразу.
    if _room_is_silent(context):
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
