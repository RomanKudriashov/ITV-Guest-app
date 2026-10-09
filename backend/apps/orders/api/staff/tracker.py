"""
REST трекера. Контракт — docs/tracker-api-contract.md.

Вьюхи тонкие. Вся авторизация — в apps/orders/services/tracker.py, потому что те же
проверки обязан выполнять WebSocket-канал, у которого нет middleware.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.orders.schemas.tracker import AcceptIn, AssignIn, PositionIn, StatusIn, TrackerCancelIn, TransferIn
from apps.orders.services import tracker as svc

router = Router(tags=["tracker"])


@router.get("/points", summary="Заведения сотрудника")
def list_points(request: HttpRequest):
    return svc.points_payload(request.user, current_language())


@router.get("/my-points", summary="«Мои точки»: сводка смены по каждой точке сотрудника")
def my_points(request: HttpRequest):
    return svc.my_points_payload(request.user, current_language())


@router.get("/orders", summary="Задачи заведения (доска / очередь / записи / заявки)")
def board(
    request: HttpRequest,
    point: str,
    scope: str = "active",
    date: str = None,
    search: str = "",
    focus: str = "",
    overdue: bool = False,
    mine: bool = False,
    unassigned: bool = False,
    assignee: str = "",
    order_type: str = "",
    room: str = "",
    status: str = "",
    since: str = "",
    until: str = "",
    cursor: str | None = None,
    limit: int | None = None,
):
    """
    `date` осмыслен только для ленты записей (спа): какой день показать.
    Остальные типы трекера его игнорируют — у них лента не по времени слота.

    `focus` — ступень: `new` / `in_work`. `overdue` — просроченные; тот же
    параметр стоит и за плиткой «просрочено», и за галкой в панели фильтров:
    два ответа на один вопрос однажды разошлись бы.

    `mine` — свои задачи. Разворачивается здесь в `assignee` текущего
    пользователя: сервис не должен знать, кто именно смотрит доску, иначе
    «мои» пришлось бы объяснять и сокету, у которого запроса нет.

    `since` / `until` — период В СУТКАХ ОТЕЛЯ (YYYY-MM-DD), осмыслен для
    истории: она отбирается по моменту ЗАКРЫТИЯ. `room` — точный номер
    комнаты, `status` — код статуса потока этой точки.

    Неизвестные значения игнорируются: ссылка с опечаткой показывает доску
    целиком, а не отказ.
    """
    execution_point = svc.require_point(request.user, point)
    board = svc.build_board(
        execution_point,
        scope=scope,
        language=current_language(),
        date=date,
        search=search,
        focus=focus,
        overdue=overdue,
        assignee=str(request.user.pk) if mine else assignee,
        unassigned=unassigned,
        order_type=order_type,
        room=room,
        status=status,
        since=since,
        until=until,
        cursor=cursor,
        limit=limit,
    )
    # Права того, кто смотрит (партия 47): кнопки рисуются по ним.
    return svc.apply_viewer(board, request.user, execution_point)


def _out(request: HttpRequest, order) -> dict:
    """Карточка + права зрителя на неё."""
    payload = svc.serialize_tracker_order(order, current_language())
    return svc.apply_viewer(payload, request.user, order.execution_point)


@router.get("/order/{order_id}", summary="Заказ на доске")
def read_order(request: HttpRequest, order_id: str):
    order = svc.get_tracker_order(request.user, order_id)
    return _out(request, order)


@router.post("/order/{order_id}/accept", summary="Взять заказ в работу")
def accept(request: HttpRequest, order_id: str, payload: AcceptIn = None):
    order = svc.accept_order(request.user, order_id)
    return _out(request, order)


@router.post("/order/{order_id}/status", summary="Двинуть статус")
def move(request: HttpRequest, order_id: str, payload: StatusIn):
    order = svc.move_status(
        request.user, order_id, to_code=payload.status, comment=payload.comment
    )
    return _out(request, order)


@router.post("/order/{order_id}/position", summary="Переставить карточку в колонке")
def reorder(request: HttpRequest, order_id: str, payload: PositionIn):
    order = svc.move_position(
        request.user, order_id, after_id=payload.after, before_id=payload.before
    )
    return _out(request, order)


@router.post("/order/{order_id}/cancel", summary="Отменить заказ")
def cancel(request: HttpRequest, order_id: str, payload: TrackerCancelIn):
    order = svc.cancel_order_by_staff(
        request.user, order_id, reason=payload.reason, cancel_reason=payload.cancel_reason
    )
    return _out(request, order)


@router.post("/order/{order_id}/assign", summary="Назначить исполнителя")
def assign(request: HttpRequest, order_id: str, payload: AssignIn):
    """Старший смены, руководитель, администратор (партия 47). Статус не меняет."""
    order = svc.assign_order(request.user, order_id, assignee_id=payload.assignee)
    return _out(request, order)


@router.post("/order/{order_id}/transfer", summary="Передать заказ на другую точку")
def transfer(request: HttpRequest, order_id: str, payload: TransferIn):
    """
    Старший смены точки-источника и выше (партия 48). Статус — начальный в
    потоке новой точки, исполнитель снят, норма времени — от переноса.
    """
    order = svc.transfer_order(request.user, order_id, to_point_code=payload.point, reason=payload.reason)
    return _out(request, order)
