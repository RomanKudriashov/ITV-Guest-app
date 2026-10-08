"""
Сервисный слой трекера: доска точки исполнения и действия над заказами.

Главное правило, ради которого этот модуль отдельный: **доступ проверяется
здесь, а не во вьюхе**. Трекер живёт наполовину на WebSocket, а у WS нет ни
middleware аутентификации, ни резолвера тенанта, ни языка. Если бы проверка
привязки сотрудника к точке жила в HTTP-слое, WS-канал оказался бы открыт.
Поэтому и REST, и WS зовут одни и те же функции отсюда.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone as datetime_timezone
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.accounts.models import StaffAssignment, User
from apps.core.errors import ConflictError, NotFoundError, PermissionDenied, ValidationError
from apps.core.fields import translate
from apps.hotels.models import ExecutionPoint, Hotel, Service

from apps.events.bus import ORDER_ACCEPTED, ORDER_STATUS_CHANGED, ORDER_TRANSFERRED, emit

from apps.orders.services import status_flows, tracker_shift
from apps.orders.services.selection import selection_summary
from apps.orders.models import Order, StatusDefinition
from apps.orders.services.services import (
    _event_payload,
    change_status,
    order_queryset,
    serialize_order,
)
from apps.orders.services.tracker_types import (
    ColumnStyle,
    GroupBy,
    behaviour_for_type,
    effective_sla_minutes,
    work_clock_start,
    work_clock_start_expression,
    tracker_type_for_point,
)


class PointNotAssigned(PermissionDenied):
    code = "point_not_assigned"


# --- Точки сотрудника ------------------------------------------------------


def sees_every_point(user) -> bool:
    """
    Администратор отеля работает СО ВСЕМИ досками без единого назначения.

    До этой правки владелец отеля не открывал ни одной: `/tracker/points`
    отдавал ноль точек, доска — `403 point_not_assigned`. Назначения у него
    нет и быть не должно — он не стоит на смене ни в одном заведении, — а
    привязывать его к каждой точке значило бы завести второй список
    «кто работает в отеле», который разъедется с первым в день открытия
    нового заведения.

    Признак берётся оттуда же, откуда права в CMS (`Access.unrestricted`), —
    второго источника правды о том, кто в отеле главный, не появляется.
    """
    from apps.accounts.services.roles import access_for

    return access_for(user).unrestricted


def assigned_points(user) -> list[ExecutionPoint]:
    if sees_every_point(user):
        return list(ExecutionPoint.objects.filter(is_active=True).order_by("code"))
    point_ids = StaffAssignment.objects.filter(user=user, is_active=True).values_list(
        "execution_point_id", flat=True
    )
    return list(
        ExecutionPoint.objects.filter(pk__in=list(point_ids), is_active=True).order_by("code")
    )


def assignment_level(user, point) -> str:
    assignment = StaffAssignment.objects.filter(
        user=user, execution_point=point, is_active=True
    ).first()
    return assignment.level if assignment else ""


def require_point(user, point_code: str) -> ExecutionPoint:
    """
    Точка + проверка привязки одним вызовом.

    Разделять их — значит однажды забыть вторую половину. Отказ намеренно
    одинаковый и для «точки нет», и для «не твоя точка» на уровне WS: чужому
    незачем узнавать, какие точки существуют в отеле.
    """
    point = ExecutionPoint.objects.filter(code=point_code, is_active=True).first()
    if point is None:
        raise NotFoundError(f"Заведение «{point_code}» не найдено")
    if sees_every_point(user):
        return point
    if not StaffAssignment.objects.filter(
        user=user, execution_point=point, is_active=True
    ).exists():
        raise PointNotAssigned(
            f"Вы не назначены на точку «{point.title_i18n or point.code}»"
        )
    return point


def require_point_for_order(user, order: Order, action: str = "read") -> ExecutionPoint:
    """Действие над заказом — по праву уровня на ЕГО точке (см. «Права по уровню»)."""
    point = order.execution_point
    require_right(user, action, point)
    return point


# --- Права по уровню (партия 47) ---------------------------------------------
#
# ОДНА ФУНКЦИЯ НА ВОПРОС «МОЖЕТ ЛИ X СДЕЛАТЬ Y С ЗАКАЗОМ ТОЧКИ P». До партии 47
# проверка была одна — «назначен на точку», и старший смены на доске не отличался
# от исполнителя. Набор прав решён тек-лидом 24.09.2026 (`docs/project-state.md`,
# «Решено, не начато»): исполнитель < старший смены < руководитель < администратор.
#
# Уровень проверяет СЕРВЕР, здесь. Фронт рисует кнопки по `rights` из ответа, а
# не по своей догадке о роли — второй экземпляр правила разъехался бы с первым.


class LevelTooLow(PermissionDenied):
    code = "level_too_low"


class Action:
    READ = "read"
    ACCEPT = "accept"
    MOVE = "move"
    REORDER = "reorder"
    CANCEL = "cancel"
    REOPEN = "reopen"
    ASSIGN = "assign"
    TRANSFER = "transfer"


ADMIN_RANK = 4
_RANK = {
    StaffAssignment.Level.MEMBER: 1,
    StaffAssignment.Level.LEAD: 2,
    StaffAssignment.Level.MANAGER: 3,
}
# Отмена — у всех на точке (решение 24.09: без изменений). Вернуть закрытый и
# назначить исполнителя — от старшего смены.
_NEEDS = {
    Action.READ: 1,
    Action.ACCEPT: 1,
    Action.MOVE: 1,
    Action.REORDER: 1,
    Action.CANCEL: 1,
    Action.REOPEN: 2,
    Action.ASSIGN: 2,
    # Передать на другую точку (партия 48) — старший смены точки-источника и выше.
    Action.TRANSFER: 2,
}
_REFUSALS = {
    Action.REOPEN: "Вернуть закрытый заказ может старший смены, руководитель или администратор",
    Action.ASSIGN: "Назначать исполнителя может старший смены, руководитель или администратор",
    Action.TRANSFER: "Передать заказ на другую точку может старший смены, руководитель или администратор",
}


def rank_on(user, point) -> int:
    """0 — к точке не привязан; 1–3 — уровень назначения; 4 — администратор отеля."""
    if sees_every_point(user):
        return ADMIN_RANK
    levels = StaffAssignment.objects.filter(
        user=user, execution_point=point, is_active=True
    ).values_list("level", flat=True)
    return max((_RANK.get(level, 0) for level in levels), default=0)


def rights_from_rank(rank: int) -> dict:
    return {action: rank >= need for action, need in _NEEDS.items()}


def _order_dicts(node):
    """Все карточки в ответе доски — где бы они ни лежали (колонки, группы, лента)."""
    if isinstance(node, dict):
        if "next_statuses" in node and "id" in node and "status" in node:
            yield node
            return
        for value in node.values():
            yield from _order_dicts(value)
    elif isinstance(node, list):
        for value in node:
            yield from _order_dicts(value)


def with_viewer(order: dict, rank: int, viewer_id: str | None) -> dict:
    """
    Права ЗРИТЕЛЯ на ЭТУ карточку — фронт рисует кнопки по ним, а не по догадке.

    Считается по уже собранному объекту заказа, поэтому одно и то же правило
    работает для ответа REST и для снимка сокета, где карточки собираются теми
    же функциями, но без знания, кто смотрит.
    """
    status = order.get("status") or {}
    terminal = bool(status.get("is_terminal"))
    cancelled = bool(status.get("is_cancelled"))
    base = rights_from_rank(rank)
    assignee = (order.get("assignee") or {}).get("id")
    accepted = bool(order.get("accepted_at"))
    rights = {
        "accept": base[Action.ACCEPT] and not terminal and not accepted
        and (assignee is None or assignee == viewer_id),
        "move": base[Action.MOVE] and not cancelled and (not terminal or base[Action.REOPEN]),
        "reorder": base[Action.REORDER] and not terminal,
        "cancel": base[Action.CANCEL] and not terminal,
        "reopen": base[Action.REOPEN] and terminal and not cancelled,
        "assign": base[Action.ASSIGN] and not terminal,
        # Остальные запреты переноса (бронь, составной заказ) сервер объясняет
        # отказом: кнопку прячем только по праву и завершённости.
        "transfer": base[Action.TRANSFER] and not terminal,
    }
    order["rights"] = rights
    order["assigned_to_me"] = bool(viewer_id) and assignee == viewer_id and not accepted
    if terminal and not rights["reopen"]:
        # Вернуть закрытый нельзя — и целей возврата на карточке нет.
        order["next_statuses"] = []
    if not rights["cancel"]:
        order["can_cancel"] = False
    return order


def apply_viewer(payload: dict, viewer, point) -> dict:
    """Доска или карточка + права того, кто смотрит (партия 47)."""
    if viewer is None:
        return payload
    rank = rank_on(viewer, point)
    viewer_id = str(viewer.pk)
    for order in _order_dicts(payload):
        with_viewer(order, rank, viewer_id)
    if "columns" in payload:
        payload["rights"] = rights_from_rank(rank)
        # Куда можно передать (партия 48) — только тому, кому можно передавать.
        payload["transfer_targets"] = (
            transfer_targets(point) if payload["rights"][Action.TRANSFER] else []
        )
    return payload


def transfer_targets(point) -> list[dict]:
    """Активные точки отеля, кроме этой, — цели переноса."""
    return [
        {"code": target.code, "title": translate(target.title, None) or target.code}
        for target in ExecutionPoint.objects.filter(is_active=True)
        .exclude(pk=point.pk)
        .order_by("code")
    ]


def require_right(user, action: str, point, *, rank: int | None = None) -> int:
    rank = rank_on(user, point) if rank is None else rank
    if rank == 0:
        raise PointNotAssigned(
            f"Заказ обслуживает точка «{point.title_i18n or point.code}», "
            "а вы к ней не привязаны"
        )
    if rank < _NEEDS[action]:
        raise LevelTooLow(_REFUSALS.get(action, "Это действие вам недоступно"), action=action)
    return rank


def serialize_point(point: ExecutionPoint, language: str | None = None, **extra) -> dict:
    tracker_type = tracker_type_for_point(point)
    behaviour = behaviour_for_type(tracker_type)
    return {
        "id": str(point.pk),
        "code": point.code,
        "title": translate(point.title, language) or point.code,
        "kind": point.kind,
        "sla_minutes": effective_sla_minutes(point),
        # ОТКУДА ВЗЯЛСЯ ПОРОГ. «Просрочка — позже 240 минут» без этого читается
        # как чья-то настройка, и управляющий идёт искать, кто её поставил.
        # `point` — задан руками, `type` — умолчание вида работы.
        "sla_source": "point" if point.sla_minutes is not None else "type",
        # Клиент рисует то, что прислал сервер: тип решает раскладку (колонки
        # или лента) и подписи действий. Выводится из типа сервиса — отдельным
        # полем не хранится.
        "tracker_type": tracker_type,
        "layout": behaviour.layout,
        **extra,
    }


def points_payload(user, language: str | None = None) -> dict:
    points = assigned_points(user)
    counts = _counts_by_point([point.pk for point in points])
    return {
        "points": [
            serialize_point(
                point,
                language,
                level=assignment_level(user, point),
                active_count=counts.get(point.pk, {}).get("active", 0),
                new_count=counts.get(point.pk, {}).get("new", 0),
            )
            for point in points
        ]
    }


def _counts_by_point(point_ids: list) -> dict:
    counts: dict[Any, dict[str, int]] = {}
    orders = (
        Order.objects.filter(execution_point_id__in=point_ids, status__is_terminal=False)
        .exclude(children__isnull=False)  # parent-агрегат на доску не идёт
        .select_related("status")
    )
    for order in orders:
        bucket = counts.setdefault(order.execution_point_id, {"active": 0, "new": 0})
        bucket["active"] += 1
        if order.status.is_initial:
            bucket["new"] += 1
    return counts


# --- Доска -----------------------------------------------------------------

def build_board(
    point: ExecutionPoint,
    *,
    scope: str = "active",
    language: str | None = None,
    date: str | None = None,
    search: str = "",
    focus: str = "",
    overdue: bool = False,
    assignee: str = "",
    unassigned: bool = False,
    order_type: str = "",
    room: str = "",
    status: str = "",
    since: str = "",
    until: str = "",
    cursor: str | None = None,
    limit: int | None = None,
) -> dict:
    """
    Колонки строятся из ПОТОКА СТАТУСОВ ЭТОЙ ТОЧКИ, а не из захардкоженного
    списка и не из всех статусов отеля: у доски ресторана «готовится → в пути»,
    у очереди хозслужбы «в работе → готово», у записей спа «пришёл → завершено».
    Клиент рисует то, что прислал сервер.

    Раскладок две (tracker_types.Layout). Колонки — доска, очередь, заявки.
    Лента — записи спа: там задача привязана ко времени слота, и группировать
    её по статусу бессмысленно, смотрят «кто следующий».
    """
    hotel = Hotel.objects.get(pk=point.hotel_id)
    tracker_type = tracker_type_for_point(point)
    behaviour = behaviour_for_type(tracker_type)
    statuses = status_flows.statuses_for_flow(status_flows.flow_for_point(point))

    # parent-агрегат исключаем: на доску идёт исполнение (children и обычные).
    queryset = (
        order_queryset()
        .filter(execution_point=point)
        .exclude(children__isnull=False)
        .select_related("assignee")
    )
    # ПОИСК на доске: 719 заказов, и человек ищет конкретный. По НОМЕРУ заказа
    # и НОМЕРУ КОМНАТЫ — по ним заказ и называют вслух («триста пятый, второй»).
    # Больше ни по чему: гостя на доске по фамилии не ищут, её там нет.
    term = (search or "").strip()
    if term:
        condition = Q(room__number__icontains=term)
        if term.isdigit():
            condition |= Q(number=int(term))
        queryset = queryset.filter(condition)

    queryset = _narrow(
        queryset,
        point,
        focus=focus,
        overdue=overdue,
        assignee=assignee,
        unassigned=unassigned,
        order_type=order_type,
        room=room,
        status=status,
    )

    next_cursor = None
    selection = None
    history_statuses = None
    if scope == "history":
        queryset = _history_queryset(
            queryset,
            since=_day_edge(since, hotel, end=False),
            until=_day_edge(until, hotel, end=True),
        )
        # ИСТОРИЯ ЛИСТАЕТСЯ КУРСОРОМ. Заказы закрываются прямо во время
        # просмотра и падают в историю сверху: при смещении вторая страница
        # показала бы часть первой, а часть — не показала бы вовсе.
        page_size = max(1, min(int(limit or 50), 200))
        if cursor:
            at, _, cursor_id = cursor.partition("|")
            moment = parse_datetime(at.replace(" ", "+")) if at else None
            if moment and cursor_id:
                queryset = queryset.filter(
                    Q(closed_key__lt=moment) | Q(closed_key=moment, pk__lt=cursor_id)
                )
        rows = list(queryset[: page_size + 1])
        has_more = len(rows) > page_size
        rows = rows[:page_size]
        if has_more and rows:
            last = rows[-1]
            next_cursor = f"{last.closed_key.isoformat()}|{last.pk}"
        # Цифры — ПО ВЫБОРКЕ, а не за смену: список без окна и сводка за
        # сегодня — разные множества (986 записей против 28 «сделано»).
        selection = selection_summary(queryset.order_by())
        # ЧЕМ НАПОЛНЯТЬ ФИЛЬТР «СТАТУС» — ЕДЕТ С ДОСКОЙ, как и «исполнитель».
        #
        # Сужать по статусу сервер умел и раньше, а выбрать статус было не из
        # чего: список кодов живёт в потоке ТОЧКИ, и клиент его не знает. Зашить
        # его на клиенте нельзя — у кухни «готовится → в пути», у хозслужбы
        # «в работе → готово», и первый же отель со своим потоком получил бы
        # фильтр, отбирающий по несуществующему коду.
        #
        # Только ТЕРМИНАЛЬНЫЕ: в истории других не бывает (`_history_queryset`
        # отбирает `is_terminal=True`), и предлагать «Готовится» значило бы
        # обещать выборку, которая всегда пуста.
        history_statuses = [
            {
                "code": status.code,
                "title": status_flows.column_title(status, language),
                "color_token": status.color_token,
            }
            for status in statuses
            if status.is_terminal
        ]
        actors = actor_names(rows)
        columns = [
            {
                "code": "history",
                "title": "",
                "orders": [
                    serialize_tracker_order(o, language, statuses, actors) for o in rows
                ],
            }
        ]
    elif behaviour.layout == "timeline":
        columns = [_timeline_column(queryset, hotel, language, statuses, date)]
    else:
        # ПОРЯДОК НА ДОСКЕ — РУЧНОЙ, И ЭТО ОДИН ПОРЯДОК НА ВСЮ СМЕНУ.
        #
        # По времени создания колонка сортироваться не может: смена сама решает,
        # что делать раньше — заказ на восемь порций из конференц-зала или кофе,
        # который придёт через минуту. Раньше этот выбор жил только в голове у
        # того, кто стоит у доски, и терялся при первом же обновлении экрана.
        #
        # `created_at` остаётся ВТОРЫМ ключом: у заказов, которых никто не
        # трогал руками, позиция совпадает с моментом создания, и порядок тот
        # же, что был до этой партии.
        queryset = queryset.filter(status__is_terminal=False).order_by(
            "board_position", "created_at"
        )
        columns = _active_columns(queryset, behaviour, statuses, language)

    return {
        "point": serialize_point(point, language),
        "scope": scope,
        "server_time": hotel.local_now().isoformat(),
        "tracker_type": tracker_type,
        "layout": behaviour.layout,
        "columns": columns,
        "next_cursor": next_cursor,
        # СВОДКА ЕДЕТ С ДОСКОЙ, А НЕ ОТДЕЛЬНОЙ РУЧКОЙ.
        #
        # Числа обязаны совпадать с тем, что человек видит в колонках. Второй
        # запрос разошёлся бы с первым на любом заказе, пришедшем между ними, —
        # и доска показывала бы «новых 4» над тремя карточками. Живой контур
        # это чинит сам: сокет присылает полный снимок, и сводка приезжает в
        # нём же, без отдельной подписки.
        #
        # Сводка про ТЕКУЩЕЕ состояние точки, поэтому она одна и та же для
        # активной доски и для истории: в истории «новых 4» — это тоже правда
        # про точку, просто на экране их не видно.
        "shift": tracker_shift.shift_summary(point, hotel=hotel),
        # Сводка ПО ВЫБОРКЕ есть только там, где выборку сужают, — в истории.
        # На активной доске её нет: там «сколько сейчас на доске» и есть ответ.
        "selection": selection,
        # Статусы для фильтра — по той же причине только в истории: на активной
        # доске статус и ЕСТЬ колонка, и второй способ отобрать по нему был бы
        # вторым ответом на тот же вопрос.
        "statuses": history_statuses,
        # Кого предлагать в фильтре «исполнитель». Едет с доской по той же
        # причине, что и сводка: отдельная ручка — отдельный повод разойтись.
        "assignees": board_assignees(point, language),
    }


def _active_columns(queryset, behaviour, statuses, language) -> list[dict]:
    """
    Колонки активной доски — ПО РЕЕСТРУ, а не по типу сервиса.

    Ни одного `if service.type == ...` здесь нет и быть не должно: вид работы
    приносит два признака (`column_style`, `group_by`), и весь разбор — по ним.
    Новый вид сервиса, работающий иначе, — это строка в реестре, а не ветка тут.
    """
    rows = list(queryset)
    # Имена — один раз на всю доску: внутри карточки это был бы запрос на
    # каждый переход каждого заказа.
    actors = actor_names(rows)

    if behaviour.column_style == ColumnStyle.SINGLE:
        # ОДНА ЛЕНТА. Два статуса ресепшена делили экран пополам и стояли
        # полупустыми: «Новая 6 / Подтверждена 0» — это не две колонки работы,
        # это одна колонка и одна пустая половина. Порядок — по этапу, потом по
        # времени: невзятое сверху, потому что именно оно требует действия.
        # Сначала этап (невзятое сверху — оно требует действия), внутри этапа —
        # тот же ручной порядок, что и в колонках: одна лента не повод терять
        # решение смены о том, что делать раньше.
        rows.sort(key=lambda order: (order.status.sort_order, order.board_position, order.created_at))
        return [
            {
                "code": "all",
                "title": "",
                "orders": [
                    serialize_tracker_order(o, language, statuses, actors) for o in rows
                ],
            }
        ]

    grouped: dict[str, list] = {}
    for order in rows:
        grouped.setdefault(order.status.code, []).append(
            serialize_tracker_order(order, language, statuses, actors)
        )

    columns = [
        {
            "code": status.code,
            # На доске и доставки, и выдачи: «В пути / Готово к выдаче».
            "title": status_flows.column_title(status, language),
            "color_token": status.color_token,
            "orders": grouped.get(status.code, []),
        }
        for status in statuses
        if not status.is_terminal
    ]

    if behaviour.group_by == GroupBy.ROOM:
        # ПО НОМЕРАМ. Горничная идёт по этажу: две заявки в одну комнату — это
        # ОДИН поход, а не два. Раньше они приезжали двумя карточками, и вторую
        # находили, уже выйдя из номера.
        #
        # `orders` остаётся плоским списком НАМЕРЕННО: по нему считаются
        # счётчики колонки, поиск и всё, что не знает про группы. Группы —
        # дополнение к нему, а не замена: иначе каждый читатель доски пришлось
        # бы учить второй форме.
        for column in columns:
            column["groups"] = _by_room(column["orders"])

    return columns


def _by_room(orders: list[dict]) -> list[dict]:
    """Заявки по комнатам, порядок — по первой заявке в комнате."""
    buckets: dict[str, list[dict]] = {}
    for order in orders:
        # Заявка без комнаты — своя группа: свалить их в общую кучу «—» значило
        # бы склеить не связанные между собой задачи в один поход.
        key = str(order.get("room") or "")
        buckets.setdefault(key, []).append(order)
    return [
        {"key": key or "none", "room": key, "orders": items}
        for key, items in buckets.items()
    ]


def _day_edge(value: str, hotel, *, end: bool):
    """
    Граница периода из «2026-09-12» — в момент СУТОК ОТЕЛЯ.

    Сутки берутся отельные, а не серверные: смена работает по своему часовому
    поясу, и «за 12 сентября» для Владивостока и для Москвы — разные отрезки.
    Мусор в адресе молча игнорируется, как и остальные фильтры.
    """
    from datetime import datetime, time

    raw = (value or "").strip()
    if not raw:
        return None
    try:
        day = datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None
    # Тем же способом, что и аналитика (`analytics/queries._aware`): один ответ
    # на вопрос «где граница суток отеля», а не второй свой.
    moment = datetime.combine(day, time.max if end else time.min)
    return moment.replace(tzinfo=hotel.tzinfo)


def _history_queryset(queryset, *, since=None, until=None):
    """
    ИСТОРИЯ — ЭТО «КОГДА ЗАКРЫЛИ», А НЕ «КОГДА СОЗДАЛИ», И ОНА БЕЗ ОКНА.

    Раньше история показывала терминальные заказы, СОЗДАННЫЕ за последние
    24 часа. Два следствия, и оба плохие:

      * заказ, сделанный позавчера и закрытый минуту назад, не попадал в неё
        НИКОГДА — ни в день создания (он ещё не закрыт), ни в день закрытия
        (он создан слишком давно). Ровно те заказы, которые разбирают дольше
        всего, и выпадали из разбора;
      * вчерашняя смена не могла посмотреть свою работу: окно сдвигалось.

    СОРТИРОВКА ПО `COALESCE(closed_at, created_at)`, И ЭТО НЕ КОСМЕТИКА.
    На стенде 821 закрытый заказ не имеет `closed_at`: их закрыла команда
    обслуживания мимо журнала (см. миграцию 0009), и выдумывать им момент
    закрытия мы отказались. В чистой сортировке по `-closed_at` Postgres
    ставит NULL ПЕРВЫМИ — самые старые заказы встали бы в начало истории, — а
    курсор на такой записи просто падает: `Cannot use None as a query value`.
    Замерено обоими способами.

    Запасной ключ ставит их на хронологическое место и делает курсор
    непрерывным. Цена: у этих заказов «закрыт» показывается как момент
    создания. Это честнее, чем прятать их или выкидывать в конец: человек ищет
    заказ, а не изучает историю наших миграций.
    """
    from django.db.models.functions import Coalesce

    queryset = queryset.filter(status__is_terminal=True).annotate(
        closed_key=Coalesce("closed_at", "created_at")
    )
    if since is not None:
        queryset = queryset.filter(closed_key__gte=since)
    if until is not None:
        queryset = queryset.filter(closed_key__lte=until)
    return queryset.order_by("-closed_key", "-pk")


def _narrow(
    queryset,
    point,
    *,
    focus: str = "",
    overdue: bool = False,
    assignee: str = "",
    unassigned: bool = False,
    order_type: str = "",
    room: str = "",
    status: str = "",
):
    """
    СУЖЕНИЕ ДОСКИ — ОДНО МЕСТО.

    Сюда приходят и клик по плитке, и панель фильтров: «только просроченные» на
    панели и плитка «просрочено» обязаны означать РОВНО одно, иначе два ответа
    на один вопрос однажды разойдутся. Поэтому у них и параметр один.

    Сужает СЕРВЕР, а не отсев уже полученной доски: отсев соврал бы на первом
    же заказе, который не приехал.

    Неизвестные значения молча игнорируются, а не отдают ошибку: фильтр — это
    удобство, и ссылка с опечаткой должна показать доску целиком, а не пустой
    экран с отказом.
    """
    if focus == "new":
        queryset = queryset.filter(status__is_initial=True)
    elif focus == "in_work":
        queryset = queryset.filter(status__is_initial=False, status__is_terminal=False)

    if overdue and point is not None:
        # Порог — настройка ТОЧКИ, и граница считается от него же, что и
        # `is_overdue` на карточке. Два разных правила «что такое просрочка»
        # разошлись бы на первой же правке настройки.
        edge = timezone.now() - timedelta(minutes=effective_sla_minutes(point))
        queryset = queryset.alias(work_clock=work_clock_start_expression()).filter(
            work_clock__lte=edge
        )

    # «Ничьи» и «конкретный исполнитель» — взаимоисключающие по смыслу.
    # Побеждает «ничьи»: его выбирают в час пик, когда важно, что НЕ ВЗЯТО, и
    # молча подмешать туда чей-то список значило бы спрятать невзятое.
    if unassigned:
        queryset = queryset.filter(assignee__isnull=True)
    elif assignee:
        try:
            queryset = queryset.filter(assignee_id=uuid.UUID(str(assignee)))
        except (ValueError, AttributeError, TypeError):
            # Мусор в адресе — доска целиком, а не отказ.
            pass

    if order_type in {Order.Type.CART, Order.Type.REQUEST}:
        queryset = queryset.filter(type=order_type)

    # КОМНАТА — точным совпадением, а не подстрокой: «305» не должен находить
    # «1305». Поиск подстрокой уже есть отдельно, и он про другое — там человек
    # не помнит номер целиком.
    if room:
        queryset = queryset.filter(room__number=str(room).strip())

    # СТАТУС: конкретный код потока этой точки. Неизвестный код игнорируем, как
    # и остальные фильтры, — ссылка с опечаткой показывает список целиком.
    if status:
        queryset = queryset.filter(status__code=status)

    return queryset


def board_assignees(point, language: str | None = None) -> list[dict]:
    """
    Кого можно выбрать в фильтре «исполнитель».

    Берём ПРИВЯЗАННЫХ к точке, а не тех, кто попался на доске: смена, у которой
    сейчас ноль заказов, обязана быть в списке — иначе управляющий не сможет
    проверить, почему у человека пусто.
    """
    from apps.accounts.models import StaffAssignment

    rows = (
        StaffAssignment.objects.filter(execution_point=point, is_active=True)
        .select_related("user")
        .order_by("user__full_name", "user__email")
    )
    return [
        {
            "id": str(row.user_id),
            "name": row.user.full_name or row.user.email,
        }
        for row in rows
    ]


def _timeline_column(queryset, hotel, language, statuses, date: str | None = None) -> dict:
    """
    Записи одного дня (по умолчанию сегодняшнего) одной лентой по времени слота.

    Завершённые из ленты НЕ уходят (`keeps_terminal_in_view`): мастеру нужен
    день целиком, чтобы понимать, где он в расписании. Отменённые уходят —
    их время освободилось. Сутки считаются в таймзоне отеля, а не серверной:
    «сегодня» у отеля во Владивостоке своё.
    """
    local_now = hotel.local_now()
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise ValidationError(
                "Дата должна быть в формате ГГГГ-ММ-ДД", code="invalid_date", field="date"
            ) from None
        start_of_day = local_now.replace(
            year=day.year, month=day.month, day=day.day,
            hour=0, minute=0, second=0, microsecond=0,
        )
    else:
        start_of_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = start_of_day.astimezone(datetime_timezone.utc)
    day_end = day_start + timedelta(days=1)

    # Идём от броней, а не от заказов: ленту упорядочивает время слота, а
    # DISTINCT по заказу с ORDER BY по связанной таблице даёт дубли.
    from apps.catalog.models import SlotBooking

    booked_ids = list(
        SlotBooking.objects.filter(
            is_active=True, starts_at__gte=day_start, starts_at__lt=day_end
        )
        .order_by("starts_at")
        .values_list("order_id", flat=True)
    )
    by_id = {
        order.pk: order
        for order in queryset.filter(pk__in=booked_ids, status__is_cancelled=False)
    }
    seen: set = set()
    orders = []
    for order_id in booked_ids:
        if order_id in by_id and order_id not in seen:
            seen.add(order_id)
            orders.append(by_id[order_id])
    return {
        "code": "day",
        "title": start_of_day.date().isoformat(),
        "date": start_of_day.date().isoformat(),
        "orders": [
            serialize_tracker_order(order, language, statuses, actor_names(orders))
            for order in orders
        ],
    }


def next_statuses(order: Order, statuses: list[StatusDefinition] | None = None) -> list[StatusDefinition]:
    """
    Куда можно двинуть из текущего статуса — вперёд И НАЗАД по пресету.

    Перепрыгивать через шаг разрешено намеренно: при самовывозе кухня уходит
    из «Принят» сразу в «Доставлено», и запрещать это значило бы заставлять
    персонал кликать ради галочки. Отмена — отдельное действие, поэтому
    статусы отмены сюда не попадают.

    НАЗАД — ПОТОМУ ЧТО ЛЮДИ ПРОМАХИВАЮТСЯ. Список «только вперёд» описывал не
    работу, а мечту о ней: нажали «Готовится» не на той карточке — и вернуть
    нечем, заказ едет дальше с неверным статусом, а потом расходятся и сводка
    смены, и время готовки. Возврат назад — обычное движение, а не авария.

    ОТМЕНЁННЫЙ ЗАКАЗ НЕ ВОЗВРАЩАЮТ: пустой список, и на доске у такой карточки
    не будет ни одной цели. Тот же запрет стоит на сервере в `change_status` —
    здесь он повторён, чтобы UI не предлагал заведомо красное действие.
    """
    if order.status.is_cancelled:
        return []
    statuses = statuses or status_flows.statuses_for_flow(order.status.flow)
    here = order.status.sort_order
    forward = [s for s in statuses if s.sort_order > here and not s.is_cancelled]
    # Назад — БЛИЖАЙШИМ ПЕРВЫМ, и весь возврат идёт ПОСЛЕ движения вперёд.
    #
    # Порядок здесь не косметика: карточка делает главной кнопкой ПЕРВЫЙ статус
    # списка, а остальное прячет в меню. Отдай мы список просто по пресету —
    # главной кнопкой у заказа в «Готовится» стал бы «Новый», то есть откат,
    # и обычный ход смены пришлось бы искать в меню. Возврат — исправление
    # ошибки, а не обычный ход, и его место ниже.
    backward = sorted(
        (s for s in statuses if s.sort_order < here and not s.is_cancelled),
        key=lambda s: s.sort_order,
        reverse=True,
    )
    return forward + backward


def actor_names(orders) -> dict:
    """
    Имена тех, кто двигал статусы, — ОДНИМ запросом на всю доску.

    Собирается по уже загруженному журналу (он приезжает `prefetch_related`),
    поэтому лишнего обращения к заказам нет: только один `IN` по учёткам.
    Системные записи `actor_id` не несут и в выборку не попадают.
    """
    ids = {
        change.actor_id
        for order in orders
        for change in order.status_changes.all()
        if change.actor_id
    }
    if not ids:
        return {}
    # ВКЛЮЧАЯ УДАЛЁННЫХ (партия 31, DEV-02): живой выборкой удалённый
    # сотрудник пропадал, и его действия в истории читались «гостем».
    return {
        user.pk: {"name": user.full_name or user.email, "deleted": user.deleted_at is not None}
        for user in User.all_objects.filter(pk__in=ids)
    }


def serialize_tracker_order(
    order: Order,
    language: str | None = None,
    statuses: list[StatusDefinition] | None = None,
    actors: dict | None = None,
) -> dict:
    """
    Гостевой объект заказа плюс то, что нужно исполнителю.

    `actors` — имена по `actor_id`, собранные ОДНИМ запросом на всю доску.
    Резолвить имя внутри сериализации значило бы запрос на каждый переход
    каждого заказа: пятьдесят карточек по пять переходов — двести пятьдесят
    запросов на один экран.
    """
    # Никто не передал имена — собираем для одного заказа. На доске их
    # передают заранее: там этот путь означал бы запрос на каждую карточку.
    if actors is None:
        actors = actor_names([order])

    payload = serialize_order(order, language)
    now = timezone.now()
    point = order.execution_point
    sla = effective_sla_minutes(point)
    # ПРОСРОЧКА — ОТ `work_clock_start` (позднейший из создания, времени гостя и
    # возврата в работу): норма времени меряет РАБОТУ, и возвращённый минуту
    # назад заказ не опоздал на сутки, что лежал закрытым.
    #
    # ОЖИДАНИЕ — ОТ ПОЗДНЕЙШЕГО ИЗ СОЗДАНИЯ И ВРЕМЕНИ ГОСТЯ, но НЕ возврата:
    # «ждёт 3 часа» — правда для гостя, он ждёт с момента заказа, что бы с
    # карточкой ни делали на кухне (решение закреплено
    # test_overdue_is_counted_from_the_return_to_work_not_from_creation). А вот
    # до названного гостем времени ждать нечего: заявка, созданная в 10:15
    # «забрать в 12:00», в 11:45 показывала «ждёт 90 минут» (бэклог 48). Пока
    # время не наступило — `due_in_minutes`, карточка пишет «на 12:00, через
    # 15 мин»; после — «ждёт» от 12:00.
    since = work_clock_start(order)
    in_work = int((now - since).total_seconds() // 60)
    # Перенесённый заказ «ждёт» на новой доске от момента переноса (партия 48).
    guest_clock = max(
        moment
        for moment in (order.created_at, order.requested_time, order.transferred_at)
        if moment
    )
    waiting = int((now - guest_clock).total_seconds() // 60)
    due_in = None
    if order.requested_time and order.requested_time > now and not order.status.is_terminal:
        # Вверх: «через 0 мин» при оставшихся 40 секундах читалось бы как «уже».
        due_in = -(-int((order.requested_time - now).total_seconds()) // 60)
    overdue = in_work - sla if not order.status.is_terminal and in_work >= sla else None

    payload.update(
        {
            "execution_point": serialize_point(point, language),
            "assignee": (
                {
                    "id": str(order.assignee_id),
                    "name": order.assignee.full_name or order.assignee.email,
                }
                if order.assignee_id
                else None
            ),
            "accepted_at": (
                order.hotel.to_local(order.accepted_at).isoformat()
                if order.accepted_at
                else None
            ),
            "source_order": _source_order(order, language),
            # Кто оформил за гостя — персонал видит имя (гость — только отдел).
            # У ПОРУЧЕНИЯ гостя нет (партия 47, п.79): «Оформил за гостя» там
            # неправда, поэтому `placed_by` пуст, а `errand` называет точку,
            # из которой его дали, и того, кто дал.
            "placed_by": (
                {"id": str(order.placed_by_id), "name": order.placed_by.full_name or order.placed_by.email}
                if order.placed_by_id and not order.source_thread_id
                else None
            ),
            "errand": _errand(order, language),
            "waiting_minutes": max(waiting, 0),
            "due_in_minutes": due_in,
            "is_overdue": overdue is not None,
            # НАСКОЛЬКО просрочен, а не только «да».
            #
            # Красный чип без величины одинаково выглядел у заказа, опоздавшего
            # на минуту, и у забытого на двое суток — а это разные новости.
            # Считаем здесь, а не на клиенте: порог живёт в настройке точки, и
            # вычитание `waiting - sla` на фронте завело бы второе место, где
            # записано, что такое просрочка.
            "overdue_minutes": overdue,
            "next_statuses": [
                {
                    "code": status.code,
                    "title": status_flows.status_title(status, order.delivery_mode, language),
                }
                for status in next_statuses(order, statuses)
            ],
            "can_cancel": not order.status.is_terminal,
            # ПРИЧИНА ОТМЕНЫ — КОДОМ И СЛОВАМИ. Код нужен, чтобы считать
            # («сколько отмен из-за стоп-листа»), название — чтобы человек
            # прочитал его без словаря. Пусто у всего, что не отменено.
            "cancel_reason": order.cancel_reason or None,
            "cancel_reason_title": (
                str(Order.CancelReason(order.cancel_reason).label)
                if order.cancel_reason in Order.CancelReason.values
                else None
            ),
            # ЖУРНАЛ ПЕРЕХОДОВ — ПЕРСОНАЛУ, А НЕ ГОСТЮ.
            #
            # Гостевой таймлайн показывает ПУТЬ заказа по потоку: где он сейчас
            # и что уже пройдено. Это правильный ответ гостю и неверный —
            # смене: путь молчит о том, что заказ возвращали, кто это сделал и
            # откуда он вернулся. Разбор смены начинается именно с этих трёх
            # вопросов.
            "journal": _journal(order, language, actors),
        }
    )
    return payload


def _journal(order: Order, language: str | None, actors: dict | None) -> list[dict]:
    """
    Журнал для персонала: переходы статусов и назначения — одной лентой по
    времени (партия 47: «кто кого назначил» — в истории заказа).
    """
    entries = [
                {
                    "kind": "status",
                    "from": change.from_status.code if change.from_status_id else None,
                    "to": change.to_status.code,
                    "title": status_flows.status_title(
                        change.to_status, order.delivery_mode, language
                    ),
                    "at": order.hotel.to_local(change.created_at).isoformat(),
                    "actor_type": change.actor_type,
                    # Имя — снимком на момент события; учётка — только чтобы
                    # сказать «удалён». Гостем запись делает лишь actor_type.
                    "actor_name": change.actor_name
                    or ((actors or {}).get(change.actor_id) or {}).get("name"),
                    "actor_deleted": bool(((actors or {}).get(change.actor_id) or {}).get("deleted")),
                    # Откат считает сервер: правило «назад по потоку» живёт в
                    # порядке статусов, и второй его экземпляр на клиенте
                    # разошёлся бы с первым при любой перенастройке пресета.
                    "is_rollback": change.is_rollback,
                    # Уточнение к отмене словами — оно писалось в журнал и
                    # раньше, но наружу не отдавалось, и прочитать его было
                    # негде.
                    "comment": change.comment or "",
                    "_sort": change.created_at,
                }
                for change in order.status_changes.all()
    ]
    entries += [
        {
            "kind": "assign",
            "at": order.hotel.to_local(item.created_at).isoformat(),
            "actor_type": "staff",
            "actor_name": item.actor_name,
            "assignee_name": item.assignee_name,
            "previous_name": item.previous_name,
            "reason": item.reason,
            "_sort": item.created_at,
        }
        for item in order.assignments.all()
    ]
    entries += [
        {
            "kind": "transfer",
            "at": order.hotel.to_local(item.created_at).isoformat(),
            "actor_type": "staff",
            "actor_name": item.actor_name,
            "from_title": item.from_title,
            "to_title": item.to_title,
            "comment": item.reason,
            "_sort": item.created_at,
        }
        for item in order.transfers.all()
    ]
    entries.sort(key=lambda entry: entry["_sort"])
    for entry in entries:
        del entry["_sort"]
    return entries


def _errand(order: Order, language: str | None) -> dict | None:
    """Поручение отдела отделу: откуда (точка переписки) и кто дал (п.79)."""
    if not order.source_thread_id:
        return None
    thread = order.source_thread
    point = getattr(thread, "execution_point", None)
    by = order.placed_by
    return {
        "from_point": (
            (translate(point.title, language) or point.code) if point is not None else ""
        ),
        "by": (by.full_name or by.email) if by is not None else "",
    }


def _source_order(order: Order, language: str | None) -> dict | None:
    """
    Пометка источника у заимствованной позиции (R2 → R3).

    Коктейль из заказа рум-сервиса приезжает на доску БАРА отдельным
    суб-заказом со своим номером. Без этой пометки бармен видит заявку
    ниоткуда: гость назовёт номер СВОЕГО заказа (агрегата), а на доске такого
    номера нет. Поэтому карточка несёт номер гостевого заказа и имя сервиса,
    через который гость его сделал.

    У обычного заказа (один исполнитель, `parent=None`) — None: никакого
    источника, кроме себя, у него нет.
    """
    if order.parent_id is None:
        return None
    parent = order.parent
    service = Service.objects.filter(execution_point_id=parent.execution_point_id).first()
    return {
        "id": str(parent.pk),
        "number": parent.number,
        "service_code": service.code if service else "",
        "service_title": (
            translate(service.public_title, language) if service else ""
        ),
    }


def get_tracker_order(user, order_id, action: str = Action.READ) -> Order:
    order = order_queryset().select_related("assignee").filter(pk=order_id).first()
    if order is None:
        raise NotFoundError("Заказ не найден")
    require_point_for_order(user, order, action)
    return order


# --- Действия --------------------------------------------------------------


@transaction.atomic
def accept_order(user, order_id) -> Order:
    """
    Взять заказ в работу.

    Блокируем строку: два официанта, нажавшие «Принять» одновременно, —
    обычное дело, и «перехват» без предупреждения был бы неприятным сюрпризом
    для того, кто уже понёс заказ.
    """
    order = get_tracker_order(user, order_id, Action.ACCEPT)
    # select_related по assignee здесь нельзя: поле nullable, Django строит
    # LEFT JOIN, а Postgres не умеет FOR UPDATE по nullable-стороне внешнего
    # соединения. Исполнителя дочитываем отдельно — он нужен только для текста
    # ошибки.
    order = Order.objects.select_for_update().select_related("status").get(pk=order.pk)

    # НАЗНАЧЕН, НО НЕ ПРИНЯТ (партия 47). Назначение старшего смены — не
    # «принято»: исполнитель жмёт «Принять» сам, и только тогда ставится момент
    # принятия и гаснет эскалация. Назначенному ему — можно; заказ, назначенный
    # другому, перехватить нельзя — это и есть смысл назначения.
    if order.assignee_id is not None and (
        order.accepted_at is not None or order.assignee_id != user.pk
    ):
        assignee = User.objects.filter(pk=order.assignee_id).first()
        name = (assignee.full_name or assignee.email) if assignee else "другой сотрудник"
        if order.accepted_at is None:
            raise ConflictError(
                f"Заказ назначен на {name}",
                code="assigned_to_other",
                assignee={"id": str(order.assignee_id), "name": name},
            )
        raise ConflictError(
            f"Заказ уже принял {name}",
            code="already_accepted",
            assignee={"id": str(order.assignee_id), "name": name},
        )
    if order.status.is_terminal:
        raise ConflictError("Заказ уже завершён", code="order_finished")

    target = _first_working_status(order)
    order.assignee = user
    order.accepted_at = timezone.now()
    order.save(update_fields=["assignee", "accepted_at", "updated_at"])

    if target is not None and target.pk != order.status_id:
        change_status(order, to_code=target.code, actor_type="staff", actor_id=user.pk)

    # Отдельное событие: для эскалации принятие — не «ещё одна смена статуса»,
    # а момент, с которого подъём по ступеням прекращается.
    emit(
        ORDER_ACCEPTED,
        {"order_id": str(order.pk), "number": order.number, "assignee_id": str(user.pk)},
        hotel_id=order.hotel_id,
        actor_type="staff",
        actor_id=user.pk,
    )
    return get_tracker_order(user, order_id)


def _first_working_status(order: Order) -> StatusDefinition | None:
    """Первый статус после текущего В ПОТОКЕ ЗАКАЗА — правило живёт в потоках."""
    return status_flows.first_working_status(order.status.flow, order.status.sort_order)


@transaction.atomic
def move_status(user, order_id, *, to_code: str, comment: str = "") -> Order:
    order = get_tracker_order(user, order_id, Action.MOVE)

    # ОТМЕНА ОБЪЯСНЯЕТСЯ ОТДЕЛЬНО, А НЕ СУХИМ «НЕЛЬЗЯ ПЕРЕЙТИ».
    #
    # У отменённого заказа список целей пуст, и общая проверка ниже ответила бы
    # «из «Отменён» нельзя перейти в «preparing»» — формально верно и
    # бесполезно: человек не понимает, это правило или сбой. Отмена
    # односторонняя навсегда, и сказать это надо словами.
    if order.status.is_cancelled:
        raise ConflictError(
            "Отменённый заказ не возвращают в работу — оформите новый",
            code="order_cancelled",
        )

    # ВЕРНУТЬ ЗАКРЫТЫЙ — право старшего смены и выше, причина обязательна
    # (партия 47). Отдельной ручки нет: возврат — это смена статуса из
    # завершённого, поэтому право проверяется здесь, по факту перехода.
    if order.status.is_terminal:
        require_right(user, Action.REOPEN, order.execution_point)
        if not (comment or "").strip():
            raise ValidationError(
                "Укажите причину возврата в работу", code="reopen_reason_required", field="comment"
            )

    allowed = {status.code for status in next_statuses(order)}
    if to_code not in allowed:
        raise ValidationError(
            f"Из статуса «{order.status.title_i18n}» нельзя перейти в «{to_code}»",
            code="invalid_transition",
            field="status",
        )

    if order.assignee_id is None:
        # Двинул статус — значит, взял на себя. Иначе доска показывала бы
        # «Готовится» вообще без исполнителя.
        Order.objects.filter(pk=order.pk).update(assignee=user, accepted_at=timezone.now())
    elif order.accepted_at is None and order.assignee_id == user.pk:
        # Назначенный сам двинул статус — значит, принял (партия 47).
        Order.objects.filter(pk=order.pk).update(accepted_at=timezone.now())

    change_status(order, to_code=to_code, actor_type="staff", actor_id=user.pk, comment=comment)
    return get_tracker_order(user, order_id)


@transaction.atomic
def move_position(user, order_id, *, after_id: str | None, before_id: str | None) -> Order:
    """
    Переставить карточку внутри её колонки.

    МЕСТО ВЫЧИСЛЯЕТСЯ СЕРЕДИНОЙ МЕЖДУ СОСЕДЯМИ, и поэтому перестановка не
    трогает ни одной чужой строки: сосед по смене, тянущий другую карточку в
    ту же секунду, пишет своё число, а не пересчитывает весь столбец.

    СОСЕДИ ОБЯЗАНЫ БЫТЬ ИЗ ТОЙ ЖЕ КОЛОНКИ. Иначе «между» ничего не значит:
    карточка получила бы число из чужой очереди и легла бы в своей неизвестно
    куда. Это не придирка к формату — ровно так выглядит запоздавший запрос,
    отправленный по экрану, который успел перестроиться.

    Терминальный заказ переставлять нечего: на активной доске его нет.
    """
    order = get_tracker_order(user, order_id, Action.REORDER)
    if order.status.is_terminal:
        raise ConflictError("Завершённого заказа на доске нет", code="order_finished")

    neighbours = {}
    for key, neighbour_id in (("after", after_id), ("before", before_id)):
        if not neighbour_id:
            continue
        neighbour = Order.objects.filter(
            pk=neighbour_id,
            execution_point_id=order.execution_point_id,
            status_id=order.status_id,
        ).first()
        if neighbour is None:
            raise ValidationError(
                "Соседняя карточка не из этой колонки",
                code="neighbour_not_in_column",
                field=key,
            )
        neighbours[key] = neighbour.board_position

    above = neighbours.get("after")
    below = neighbours.get("before")
    if above is not None and below is not None:
        if above >= below:
            raise ValidationError(
                "Соседи перечислены не в том порядке", code="neighbours_swapped", field="after"
            )
        position = (above + below) / 2
    elif above is not None:
        position = above + 1.0
    elif below is not None:
        position = below - 1.0
    else:
        # Ни одного соседа — колонка пуста, кроме самой карточки. Оставляем как
        # есть: придумывать ей новое число не за что.
        position = order.board_position

    Order.objects.filter(pk=order.pk).update(board_position=position)
    order.refresh_from_db()
    # Доска обновляется у всех, а не только у того, кто тянул: порядок общий,
    # и вторая половина смены обязана увидеть то же, что первая.
    payload = _event_payload(order)
    payload["from_status"] = order.status.code
    payload["to_status"] = order.status.code
    emit(
        ORDER_STATUS_CHANGED,
        payload,
        hotel_id=order.hotel_id,
        actor_type="staff",
        actor_id=user.pk,
    )
    return get_tracker_order(user, order_id)


@transaction.atomic
def cancel_order_by_staff(user, order_id, *, reason: str = "", cancel_reason: str = "") -> Order:
    order = get_tracker_order(user, order_id, Action.CANCEL)
    if order.status.is_terminal:
        raise ConflictError("Заказ уже завершён", code="cancel_not_allowed")

    cancelled = status_flows.cancelled_status(order.status.flow)
    if cancelled is None:
        raise ValidationError(
            f"В потоке «{order.status.flow}» нет статуса отмены", code="status_preset_missing"
        )

    change_status(
        order,
        to_code=cancelled.code,
        actor_type="staff",
        actor_id=user.pk,
        comment=reason,
        cancel_reason=cancel_reason,
    )
    return get_tracker_order(user, order_id)


@transaction.atomic
def assign_order(user, order_id, *, assignee_id) -> Order:
    """
    Назначить исполнителя (партия 47) — старший смены, руководитель, администратор.

    НАЗНАЧЕНИЕ — НЕ «ПРИНЯТО». Статус не меняется, `accepted_at` не ставится:
    эскалация идёт, пока назначенный сам не нажмёт «Принять». Иначе назначение
    глушило бы подъём заявки ровно тогда, когда за неё ещё никто не взялся.

    Выбрать можно ТОЛЬКО того, кто назначен на точку заказа: человек с другой
    точки этой доски не видит, и заказ, назначенный ему, повис бы ничьим.
    Переназначить тоже можно — в любой незавершённой ступени.
    """
    import uuid as _uuid

    from apps.orders.models import OrderAssignment

    order = get_tracker_order(user, order_id, Action.ASSIGN)
    order = Order.objects.select_for_update().select_related("status").get(pk=order.pk)
    if order.status.is_terminal:
        raise ConflictError("Заказ уже завершён", code="order_finished")

    try:
        target_id = _uuid.UUID(str(assignee_id))
    except (TypeError, ValueError):
        target_id = None
    target = User.objects.filter(pk=target_id).first() if target_id else None
    if target is None or not StaffAssignment.objects.filter(
        user=target, execution_point_id=order.execution_point_id, is_active=True
    ).exists():
        raise ValidationError(
            "Назначить можно только сотрудника этой точки",
            code="assignee_not_on_point",
            field="assignee",
        )
    if order.assignee_id == target.pk:
        return get_tracker_order(user, order_id)

    previous = User.all_objects.filter(pk=order.assignee_id).first() if order.assignee_id else None
    Order.objects.filter(pk=order.pk).update(assignee=target)
    OrderAssignment.objects.create(
        order=order,
        assignee_id_snapshot=target.pk,
        assignee_name=(target.full_name or target.email)[:255],
        previous_name=((previous.full_name or previous.email) if previous else "")[:255],
        actor_id=user.pk,
        actor_name=(user.full_name or user.email)[:255],
    )
    order.refresh_from_db()

    # Доска обновляется у всех: как перестановка — событием «статус тот же».
    payload = _event_payload(order)
    payload["from_status"] = order.status.code
    payload["to_status"] = order.status.code
    emit(ORDER_STATUS_CHANGED, payload, hotel_id=order.hotel_id, actor_type="staff", actor_id=user.pk)

    _notify_assigned(order, target, user)
    return get_tracker_order(user, order_id)


def _notify_assigned(order: Order, target, by_user) -> None:
    """Назначенному — событие «Вам назначили заказ» (поимённо, после коммита)."""
    from apps.notifications.services import event_values
    from apps.notifications.services.events import notify

    values = event_values.order_assigned(order, by_user.full_name or by_user.email)
    dedupe = f"order.assigned:{order.pk}:{target.pk}:{int(timezone.now().timestamp())}"

    hotel_id = order.hotel_id

    def send() -> None:
        # После коммита контекст отеля мог уже закрыться (колбэк — вне запроса):
        # ставим его явно, иначе журнал событий отказывает «нужен отель».
        from apps.core.context import tenant_context

        try:
            with tenant_context(hotel_id):
                notify("order.assigned", values, user_id=target.pk, dedupe_key=dedupe)
        except Exception:  # noqa: BLE001 — уведомление не вправе уронить назначение
            import logging

            logging.getLogger(__name__).warning("Уведомление о назначении %s не записано", order.pk, exc_info=True)

    transaction.on_commit(send)



@transaction.atomic
def transfer_order(user, order_id, *, to_point_code: str, reason: str) -> Order:
    """
    Передать заказ на другую точку (партия 48).

    Решения тек-лида (разведка партии 48): статус — в НАЧАЛЬНЫЙ статус потока
    новой точки (1б); переносится только незавершённый заказ без брони, не
    часть составного и не его родитель (2а); исполнитель и «принято» сброшены
    (3а); норма времени на новой доске — от момента переноса (4а); эскалация
    старой точки гаснет, новой — планируется от переноса (5а); перенос пишется
    в свой журнал (7а).

    Журнал статусов НЕ пишется: сброс в начальный статус — не «откат», и лента
    гостя не должна показывать возврат назад. Перенос виден в журнале
    переносов, а гостю — строкой «Передали в «…»».
    """
    from apps.orders.models import OrderAssignment, OrderTransfer
    from apps.orders.services.services import board_edge

    order = get_tracker_order(user, order_id, Action.TRANSFER)
    order = Order.objects.select_for_update().select_related("status", "execution_point").get(pk=order.pk)

    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("Укажите причину переноса", code="transfer_reason_required", field="reason")
    if order.status.is_terminal:
        raise ValidationError("Завершённый заказ не переносят", code="transfer_order_finished")
    if order.parent_id is not None:
        raise ValidationError(
            "Часть составного заказа не переносят — она привязана к своему заведению",
            code="transfer_part_of_composite",
        )
    if Order.objects.filter(parent_id=order.pk).exists():
        raise ValidationError("Составной заказ не переносят", code="transfer_composite_parent")
    if order.slot_bookings.exists():
        raise ValidationError(
            "Заказ с бронью времени не переносят — бронь занимает слот своей точки",
            code="transfer_has_booking",
        )

    target = ExecutionPoint.objects.filter(code=to_point_code, is_active=True).first()
    if target is None:
        raise ValidationError("Точка не найдена", code="transfer_point_not_found", field="point")
    source = order.execution_point
    if target.pk == source.pk:
        raise ValidationError("Заказ уже на этой точке", code="transfer_same_point", field="point")

    initial = status_flows.initial_status(status_flows.flow_for_point(target))
    if initial is None:
        raise ValidationError(
            "У новой точки нет начального статуса", code="status_preset_missing"
        )

    now = timezone.now()
    number = OrderTransfer.all_objects.filter(order=order).count() + 1
    previous_assignee = (
        User.all_objects.filter(pk=order.assignee_id).first() if order.assignee_id else None
    )
    actor_name = (user.full_name or user.email)[:255]

    Order.objects.filter(pk=order.pk).update(
        execution_point=target,
        status=initial,
        assignee=None,
        accepted_at=None,
        transferred_at=now,
        board_position=board_edge(target.pk, initial.pk, top=True),
        updated_at=now,
    )
    OrderTransfer.objects.create(
        order=order,
        number=number,
        from_point=source,
        to_point=target,
        from_title=(translate(source.title, None) or source.code)[:255],
        to_title=(translate(target.title, None) or target.code)[:255],
        actor_id=user.pk,
        actor_name=actor_name,
        reason=reason[:255],
    )
    if previous_assignee is not None:
        OrderAssignment.objects.create(
            order=order,
            assignee_id_snapshot=None,
            assignee_name="",
            previous_name=(previous_assignee.full_name or previous_assignee.email)[:255],
            actor_id=user.pk,
            actor_name=actor_name,
            reason="transfer",
        )

    order.refresh_from_db()
    payload = _event_payload(order)
    payload.update(
        {
            "from_point_id": str(source.pk),
            "to_point_id": str(target.pk),
            "transfer_number": number,
            "to_title": translate(target.title, None) or target.code,
        }
    )
    emit(ORDER_TRANSFERRED, payload, hotel_id=order.hotel_id, actor_type="staff", actor_id=user.pk)
    return get_tracker_order(user, order_id) if rank_on(user, target) else order
