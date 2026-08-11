"""
Диагностика инженера: журнал обмена с iRidi и состояние связи (ТЗ §14.3, §6.8).

НОВЫХ ДАННЫХ ЗДЕСЬ НЕ ПОЯВЛЯЕТСЯ. Всё, что отдаёт этот модуль, уже записано:
обмен — в `AuditLog` (`grms.command`, `grms.read`, пишет `services/commands.py`),
состояние узла — в `OnPremNode`, доступность endpoint'а — в кэше из heartbeat
(`services/liveness.py`). Своего опроса оборудования модуль не делает: экран
диагностики обязан показывать то, что БЫЛО, а не устраивать новый обмен на
каждое открытие.

Причины отказа (§6.8) в данных различаются с самого начала — коды пишет
`transport/adapter.py`. Здесь они только переводятся на язык требования, и
перевод этот односторонний: гостю причина по-прежнему не уходит никогда,
у него один нейтральный текст (`services/guest.py`).
"""

from __future__ import annotations

from datetime import date as date_cls
from datetime import datetime, time

from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.core.models import AuditLog
from apps.grms.transport import adapter

ACTION_COMMAND = "grms.command"
ACTION_READ = "grms.read"
ACTIONS = (ACTION_COMMAND, ACTION_READ)

# Потолок выдачи. Журнал отеля растёт непрерывно, и отдать его целиком — способ
# положить и экран, и браузер инженера.
MAX_LIMIT = 500
DEFAULT_LIMIT = 100

# Исходы, при которых обмен состоялся. Всё остальное в поле `result` — это код
# причины, а не статус (у чтения туда кладётся именно код ошибки).
_OK_RESULTS = {"ok", "confirmed", "unconfirmed", "accepted"}

# Пять причин ТЗ §6.8 — ровно теми словами, которыми они названы в требовании.
# Коды слева приходят из `adapter`, и одной причине их соответствует несколько:
# «устройство или канал не найден» — это три разных ответа iRidi.
REASON_LABELS = {
    adapter.CONNECTOR_OFFLINE: "коннектор не подключён",
    adapter.ENDPOINT_UNREACHABLE: "endpoint iRidi недоступен",
    adapter.ENDPOINT_UNKNOWN: "endpoint iRidi недоступен",
    adapter.BAD_RESPONSE: "iRidi вернул некорректный ответ",
    adapter.TIMEOUT: "превышен тайм-аут",
    adapter.TTL_EXPIRED: "превышен тайм-аут",
    adapter.DEVICE_NOT_FOUND: "устройство или канал не найдены",
    adapter.CHANNEL_NOT_FOUND: "устройство или канал не найдены",
    adapter.DEVICE_OR_CHANNEL_NOT_FOUND: "устройство или канал не найдены",
    adapter.REQUEST_REJECTED: "запрос отклонён коннектором",
}


def outcomes() -> list[str]:
    """Значения фильтра «исход» — те же, что кладёт в журнал `commands.py`."""
    return ["confirmed", "unconfirmed", "accepted", "failed", "ok"]


def _reason_of(payload: dict) -> str:
    """
    Причина отказа одной строкой.

    Транспортная причина главнее прикладной: если до iRidi не доехали, его
    ответа не существует, и показывать «некорректный ответ» поверх «коннектор
    не подключён» значило бы назвать инженеру не то место.
    """
    transport_error = payload.get("transport_error")
    if transport_error:
        return str(transport_error)
    for key in ("error", "result"):
        value = payload.get(key)
        if value and str(value) not in _OK_RESULTS:
            return str(value)
    return ""


def _serialize(entry: AuditLog, kinds: dict[str, str]) -> dict:
    """
    Строка журнала как она записана. Восемь полей ТЗ §14.3 — все отсюда.

    `element_kind` — единственное поле, которого в записи нет: вид элемента
    живёт в конфигурации и добывается по слугу. Помечен отдельно и на выдаче,
    и в контракте, потому что для строки, записанной до перепубликации, он
    может не разрешиться вовсе — тогда пусто, а не догадка.
    """
    payload = entry.payload or {}
    reason = _reason_of(payload)
    element = payload.get("element") or ""
    return {
        "id": str(entry.pk),
        "at": entry.created_at.isoformat(),
        "action": entry.action,
        "room": payload.get("room") or "",
        "element": element,
        "element_kind": kinds.get(element, ""),
        "device": payload.get("device") or "",
        "command": payload.get("command") or "",
        "feedback": payload.get("feedback") or "",
        "request_id": payload.get("requestID") or "",
        "sent": payload.get("sent"),
        "observed": payload.get("observed", payload.get("value")),
        "raw_response": payload.get("raw_response") or "",
        "duration_ms": payload.get("duration_ms"),
        "result": payload.get("result") or "",
        "reason": reason,
        "reason_label": REASON_LABELS.get(reason, "") if reason else "",
    }


def _element_kinds(hotel) -> dict[str, str]:
    """
    Слуг элемента → его вид, по ТЕКУЩЕЙ конфигурации.

    Разбирать слуг строкой нельзя — модель `ControlElement` прямо запрещает:
    `ac.1` это идентификатор, а не признак вида. Поэтому вид добывается
    справочником, и только для показа и фильтра; в самой записи журнала его
    нет, и задним числом он может не найтись.
    """
    from apps.grms.models import ControlElement

    with tenant_context(hotel):
        return dict(ControlElement.objects.values_list("slug", "kind"))


def _day_bounds(hotel, value: str, *, end: bool) -> datetime | None:
    """Граница промежутка из даты ГГГГ-ММ-ДД — в сутках ОТЕЛЯ, не сервера."""
    if not value:
        return None
    try:
        day = date_cls.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError(
            f"Некорректная дата: «{value}». Ожидается ГГГГ-ММ-ДД",
            field="date_to" if end else "date_from",
            code="bad_date",
        ) from None
    moment = datetime.combine(day, time.max if end else time.min)
    return moment.replace(tzinfo=hotel.tzinfo)


def journal(
    hotel,
    *,
    room: str = "",
    element_kind: str = "",
    outcome: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = DEFAULT_LIMIT,
) -> dict:
    """
    Обмен с iRidi по отелю, новые сверху.

    Фильтры комбинируются (AND). Список без фильтров в этом проекте уже
    подводил, поэтому они здесь с первого дня, а не «когда понадобится».
    """
    frm = _day_bounds(hotel, date_from, end=False)
    to = _day_bounds(hotel, date_to, end=True)
    if frm and to and to < frm:
        raise ValidationError(
            f"Начало промежутка ({date_from}) позже конца ({date_to})",
            field="date_from",
            code="bad_range",
        )
    if outcome and outcome not in outcomes():
        raise ValidationError(
            f"Неизвестный исход «{outcome}». Ожидается один из: " + ", ".join(outcomes()),
            field="outcome",
            code="bad_outcome",
        )
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    kinds = _element_kinds(hotel)
    with tenant_context(hotel):
        # Тенант скоупится менеджером и подпирается RLS: чужой отель сюда не
        # попадает, даже если фильтр по номеру совпал по строке. Номера комнат
        # у отелей одинаковые сплошь и рядом — «305» есть у каждого второго.
        queryset = AuditLog.objects.filter(action__in=ACTIONS, hotel_id=hotel.pk)
        if room:
            queryset = queryset.filter(payload__room=room)
        if outcome:
            queryset = queryset.filter(payload__result=outcome)
        if element_kind:
            slugs = [slug for slug, kind in kinds.items() if kind == element_kind]
            # Вид без единого элемента в конфигурации — пустая выдача, а не
            # снятый фильтр: «ничего не нашлось» честнее, чем «вот всё подряд».
            queryset = queryset.filter(payload__element__in=slugs or ["__none__"])
        if frm:
            queryset = queryset.filter(created_at__gte=frm)
        if to:
            queryset = queryset.filter(created_at__lte=to)

        entries = list(queryset.order_by("-created_at")[: limit + 1])

    truncated = len(entries) > limit
    rows = [_serialize(entry, kinds) for entry in entries[:limit]]
    return {
        "rows": rows,
        # Честно говорим, что выдача обрезана, а не молчим: инженер, ищущий
        # отказ трёхдневной давности, должен знать, что смотрит не всё.
        "truncated": truncated,
        "limit": limit,
    }


def link_state(hotel) -> dict:
    """
    Три звена связи ПОРОЗНЬ (ТЗ §6.1, §14 «статусы отображаются отдельно»).

    Именно порознь: «управление недоступно» одной строкой — это то, что видит
    гость, и инженеру от такой строки нет никакой пользы. Ему нужно знать, на
    каком из трёх звеньев оборвалось.

    Читаемость состояний берётся из ПОСЛЕДНЕГО чтения в журнале, а не новым
    опросом: открытие экрана диагностики не должно ходить в оборудование
    живого отеля. Поэтому у неё своё время — видно, насколько сведения свежи.
    """
    from apps.grms.services import liveness
    from apps.grms.transport import transport
    from apps.hotels.models import OnPremNode

    with tenant_context(hotel):
        node = (
            OnPremNode.objects.filter(is_revoked=False)
            .filter(purpose__in=[OnPremNode.Purpose.GRMS, OnPremNode.Purpose.BOTH])
            .order_by("-last_seen_at")
            .first()
        )
        last_read = (
            AuditLog.objects.filter(action=ACTION_READ, hotel_id=hotel.pk)
            .order_by("-created_at")
            .first()
        )

    reachable = liveness.endpoint_reachable(hotel.pk)
    connector_online = transport.node_is_online(hotel)

    if last_read is None:
        readable = {"state": "unknown", "reason": "", "reason_label": "", "at": None}
    else:
        reason = _reason_of(last_read.payload or {})
        readable = {
            "state": "unreadable" if reason else "ok",
            "reason": reason,
            "reason_label": REASON_LABELS.get(reason, "") if reason else "",
            "at": last_read.created_at.isoformat(),
        }

    return {
        "connector": {
            # `unknown` — узел отелю вообще не заводили; это не то же самое,
            # что заведён и молчит, и чинится это по-разному.
            "state": "unknown" if node is None else ("online" if connector_online else "offline"),
            "name": node.name if node else "",
            "last_seen_at": node.last_seen_at.isoformat() if node and node.last_seen_at else None,
            "version": node.version if node else "",
        },
        "iridi_endpoint": {
            # None от liveness — «узел про endpoint ещё не сообщал». Считать
            # это отказом нельзя: коннектор, поднявшийся секунду назад, просто
            # не успел прислать первый heartbeat.
            "state": "unknown" if reachable is None else ("reachable" if reachable else "unreachable"),
        },
        "state_readable": readable,
        "checked_at": timezone.now().isoformat(),
    }
