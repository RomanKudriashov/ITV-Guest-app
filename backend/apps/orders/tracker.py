"""
Сервисный слой трекера: доска точки исполнения и действия над заказами.

Главное правило, ради которого этот модуль отдельный: **доступ проверяется
здесь, а не во вьюхе**. Трекер живёт наполовину на WebSocket, а у WS нет ни
middleware аутентификации, ни резолвера тенанта, ни языка. Если бы проверка
привязки сотрудника к точке жила в HTTP-слое, WS-канал оказался бы открыт.
Поэтому и REST, и WS зовут одни и те же функции отсюда.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import StaffAssignment, User
from apps.core.errors import ConflictError, NotFoundError, PermissionDenied, ValidationError
from apps.core.fields import translate
from apps.hotels.models import ExecutionPoint, Hotel

from .models import Order, StatusDefinition
from .services import change_status, order_queryset, serialize_order


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
        raise NotFoundError(f"Точка исполнения «{point_code}» не найдена")
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
    return {
        "id": str(point.pk),
        "code": point.code,
        "title": translate(point.title, language) or point.code,
        "kind": point.kind,
        "sla_minutes": point.sla_minutes,
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
    orders = Order.objects.filter(
        execution_point_id__in=point_ids, status__is_terminal=False
    ).select_related("status")
    for order in orders:
        bucket = counts.setdefault(order.execution_point_id, {"active": 0, "new": 0})
        bucket["active"] += 1
        if order.status.is_initial:
            bucket["new"] += 1
    return counts


# --- Доска -----------------------------------------------------------------

HISTORY_WINDOW_HOURS = 24


def build_board(
    point: ExecutionPoint, *, scope: str = "active", language: str | None = None
) -> dict:
    """
    Колонки строятся из ПРЕСЕТА СТАТУСОВ ОТЕЛЯ, а не из захардкоженного списка:
    у ресторана «готовится → в пути», у SPA будет своё. Клиент рисует то, что
    прислал сервер.
    """
    hotel = Hotel.objects.get(pk=point.hotel_id)
    statuses = list(StatusDefinition.objects.order_by("sort_order"))

    queryset = order_queryset().filter(execution_point=point).select_related("assignee")
    if scope == "history":
        since = timezone.now() - timedelta(hours=HISTORY_WINDOW_HOURS)
        queryset = queryset.filter(status__is_terminal=True, created_at__gte=since).order_by(
            "-created_at"
        )
        columns = [
            {
                "code": "history",
                "title": "",
                "orders": [serialize_tracker_order(o, language, statuses) for o in queryset],
            }
        ]
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
        "columns": columns,
    }


def next_statuses(order: Order, statuses: list[StatusDefinition] | None = None) -> list[StatusDefinition]:
    """
    Куда можно двинуть из текущего статуса — только вперёд по пресету.

    Перепрыгивать через шаг разрешено намеренно: при самовывозе кухня уходит
    из «Принят» сразу в «Доставлено», и запрещать это значило бы заставлять
    персонал кликать ради галочки. Отмена — отдельное действие, поэтому
    статусы отмены сюда не попадают.
    """
    statuses = statuses or list(StatusDefinition.objects.order_by("sort_order"))
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
            "waiting_minutes": max(waiting, 0),
            "is_overdue": (
                not order.status.is_terminal and waiting >= point.sla_minutes
            ),
            "next_statuses": [
                {"code": status.code, "title": translate(status.title, language)}
                for status in next_statuses(order, statuses)
            ],
            "can_cancel": not order.status.is_terminal,
        }
    )
    return payload


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

    return get_tracker_order(user, order_id)


def _first_working_status(order: Order) -> StatusDefinition | None:
    """Первый статус после начального — «Принят» в демо-пресете."""
    return (
        StatusDefinition.objects.filter(
            sort_order__gt=order.status.sort_order, is_cancelled=False, is_terminal=False
        )
        .order_by("sort_order")
        .first()
    )


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

    cancelled = StatusDefinition.objects.filter(is_cancelled=True).order_by("sort_order").first()
    if cancelled is None:
        raise ValidationError(
            "В пресете статусов отеля нет статуса отмены", code="status_preset_missing"
        )

    change_status(
        order, to_code=cancelled.code, actor_type="staff", actor_id=user.pk, comment=reason
    )
    return get_tracker_order(user, order_id)
