"""
REST трекера. Контракт — docs/tracker-api-contract.md.

Вьюхи тонкие. Вся авторизация — в apps/orders/services/tracker.py, потому что те же
проверки обязан выполнять WebSocket-канал, у которого нет middleware.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.orders.schemas.tracker import AcceptIn, CancelIn, StatusIn
from apps.orders.services import tracker as svc

router = Router(tags=["tracker"])


@router.get("/points", summary="Заведения сотрудника")
def list_points(request: HttpRequest):
    return svc.points_payload(request.user, current_language())


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

    Неизвестные значения игнорируются: ссылка с опечаткой показывает доску
    целиком, а не отказ.
    """
    execution_point = svc.require_point(request.user, point)
    return svc.build_board(
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
        cursor=cursor,
        limit=limit,
    )


@router.get("/order/{order_id}", summary="Заказ на доске")
def read_order(request: HttpRequest, order_id: str):
    order = svc.get_tracker_order(request.user, order_id)
    return svc.serialize_tracker_order(order, current_language())


@router.post("/order/{order_id}/accept", summary="Взять заказ в работу")
def accept(request: HttpRequest, order_id: str, payload: AcceptIn = None):
    order = svc.accept_order(request.user, order_id)
    return svc.serialize_tracker_order(order, current_language())


@router.post("/order/{order_id}/status", summary="Двинуть статус")
def move(request: HttpRequest, order_id: str, payload: StatusIn):
    order = svc.move_status(
        request.user, order_id, to_code=payload.status, comment=payload.comment
    )
    return svc.serialize_tracker_order(order, current_language())


@router.post("/order/{order_id}/cancel", summary="Отменить заказ")
def cancel(request: HttpRequest, order_id: str, payload: CancelIn):
    order = svc.cancel_order_by_staff(request.user, order_id, reason=payload.reason)
    return svc.serialize_tracker_order(order, current_language())
