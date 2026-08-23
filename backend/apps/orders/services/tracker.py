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

from apps.events.bus import ORDER_ACCEPTED, emit

from apps.orders.services import status_flows, tracker_shift
from apps.orders.models import Order, StatusDefinition
from apps.orders.services.services import change_status, order_queryset, serialize_order
from apps.orders.services.tracker_types import behaviour_for_type, tracker_type_for_point


class PointNotAssigned(PermissionDenied):
    code = "point_not_assigned"


# --- Точки сотрудника ------------------------------------------------------


def assigned_points(user) -> list[ExecutionPoint]:
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
    if not StaffAssignment.objects.filter(
        user=user, execution_point=point, is_active=True
    ).exists():
        raise PointNotAssigned(
            f"Вы не назначены на точку «{point.title_i18n or point.code}»"
        )
    return point


def require_point_for_order(user, order: Order) -> ExecutionPoint:
    """Действия над заказом разрешены только исполнителям его точки."""
    point = order.execution_point
    if not StaffAssignment.objects.filter(
        user=user, execution_point=point, is_active=True
    ).exists():
        raise PointNotAssigned(
            f"Заказ обслуживает точка «{point.title_i18n or point.code}», "
            "а вы к ней не привязаны"
        )
    return point


def serialize_point(point: ExecutionPoint, language: str | None = None, **extra) -> dict:
    tracker_type = tracker_type_for_point(point)
    behaviour = behaviour_for_type(tracker_type)
    return {
        "id": str(point.pk),
        "code": point.code,
        "title": translate(point.title, language) or point.code,
        "kind": point.kind,
        "sla_minutes": point.sla_minutes,
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

HISTORY_WINDOW_HOURS = 24


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
    )

    next_cursor = None
    if scope == "history":
        since = timezone.now() - timedelta(hours=HISTORY_WINDOW_HOURS)
        queryset = queryset.filter(status__is_terminal=True, created_at__gte=since).order_by(
            "-created_at", "-pk"
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
                    Q(created_at__lt=moment) | Q(created_at=moment, pk__lt=cursor_id)
                )
        rows = list(queryset[: page_size + 1])
        has_more = len(rows) > page_size
        rows = rows[:page_size]
        if has_more and rows:
            last = rows[-1]
            next_cursor = f"{last.created_at.isoformat()}|{last.pk}"
        columns = [
            {
                "code": "history",
                "title": "",
                "orders": [serialize_tracker_order(o, language, statuses) for o in rows],
            }
        ]
    elif behaviour.layout == "timeline":
        columns = [_timeline_column(queryset, hotel, language, statuses, date)]
    else:
        queryset = queryset.filter(status__is_terminal=False).order_by("created_at")
        grouped: dict[str, list] = {}
        for order in queryset:
            grouped.setdefault(order.status.code, []).append(
                serialize_tracker_order(order, language, statuses)
            )
        columns = [
            {
                "code": status.code,
                "title": translate(status.title, language),
                "color_token": status.color_token,
                "orders": grouped.get(status.code, []),
            }
            for status in statuses
            if not status.is_terminal
        ]

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
        # Кого предлагать в фильтре «исполнитель». Едет с доской по той же
        # причине, что и сводка: отдельная ручка — отдельный повод разойтись.
        "assignees": board_assignees(point, language),
    }


def _narrow(
    queryset,
    point,
    *,
    focus: str = "",
    overdue: bool = False,
    assignee: str = "",
    unassigned: bool = False,
    order_type: str = "",
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

    if overdue:
        # Порог — настройка ТОЧКИ, и граница считается от него же, что и
        # `is_overdue` на карточке. Два разных правила «что такое просрочка»
        # разошлись бы на первой же правке настройки.
        edge = timezone.now() - timedelta(minutes=point.sla_minutes)
        queryset = queryset.filter(created_at__lte=edge)

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
        "orders": [serialize_tracker_order(order, language, statuses) for order in orders],
    }


def next_statuses(order: Order, statuses: list[StatusDefinition] | None = None) -> list[StatusDefinition]:
    """
    Куда можно двинуть из текущего статуса — только вперёд по пресету.

    Перепрыгивать через шаг разрешено намеренно: при самовывозе кухня уходит
    из «Принят» сразу в «Доставлено», и запрещать это значило бы заставлять
    персонал кликать ради галочки. Отмена — отдельное действие, поэтому
    статусы отмены сюда не попадают.
    """
    statuses = statuses or status_flows.statuses_for_flow(order.status.flow)
    return [
        status
        for status in statuses
        if status.sort_order > order.status.sort_order and not status.is_cancelled
    ]


def serialize_tracker_order(
    order: Order, language: str | None = None, statuses: list[StatusDefinition] | None = None
) -> dict:
    """Гостевой объект заказа плюс то, что нужно исполнителю."""
    payload = serialize_order(order, language)
    waiting = int((timezone.now() - order.created_at).total_seconds() // 60)
    point = order.execution_point
    overdue = (
        waiting - point.sla_minutes
        if not order.status.is_terminal and waiting >= point.sla_minutes
        else None
    )

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
            "waiting_minutes": max(waiting, 0),
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
                {"code": status.code, "title": translate(status.title, language)}
                for status in next_statuses(order, statuses)
            ],
            "can_cancel": not order.status.is_terminal,
        }
    )
    return payload


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


def get_tracker_order(user, order_id) -> Order:
    order = order_queryset().select_related("assignee").filter(pk=order_id).first()
    if order is None:
        raise NotFoundError("Заказ не найден")
    require_point_for_order(user, order)
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
    order = get_tracker_order(user, order_id)
    # select_related по assignee здесь нельзя: поле nullable, Django строит
    # LEFT JOIN, а Postgres не умеет FOR UPDATE по nullable-стороне внешнего
    # соединения. Исполнителя дочитываем отдельно — он нужен только для текста
    # ошибки.
    order = Order.objects.select_for_update().select_related("status").get(pk=order.pk)

    if order.assignee_id is not None:
        assignee = User.objects.filter(pk=order.assignee_id).first()
        name = (assignee.full_name or assignee.email) if assignee else "другой сотрудник"
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
    order = get_tracker_order(user, order_id)

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

    change_status(order, to_code=to_code, actor_type="staff", actor_id=user.pk, comment=comment)
    return get_tracker_order(user, order_id)


@transaction.atomic
def cancel_order_by_staff(user, order_id, *, reason: str = "") -> Order:
    order = get_tracker_order(user, order_id)
    if order.status.is_terminal:
        raise ConflictError("Заказ уже завершён", code="cancel_not_allowed")

    cancelled = status_flows.cancelled_status(order.status.flow)
    if cancelled is None:
        raise ValidationError(
            f"В потоке «{order.status.flow}» нет статуса отмены", code="status_preset_missing"
        )

    change_status(
        order, to_code=cancelled.code, actor_type="staff", actor_id=user.pk, comment=reason
    )
    return get_tracker_order(user, order_id)
