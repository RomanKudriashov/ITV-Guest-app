"""
REST трекера. Контракт — docs/tracker-api-contract.md.

Вьюхи тонкие. Вся авторизация — в apps/orders/tracker.py, потому что те же
проверки обязан выполнять WebSocket-канал, у которого нет middleware.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

from apps.core.context import current_language
from apps.orders import tracker as svc

router = Router(tags=["tracker"])


class StatusIn(Schema):
    status: str
    comment: str = ""


class CancelIn(Schema):
    reason: str = ""


class AcceptIn(Schema):
    pass


@router.get("/points", summary="Точки исполнения сотрудника")
def list_points(request: HttpRequest):
    return svc.points_payload(request.user, current_language())


@router.get("/orders", summary="Доска точки")
def board(request: HttpRequest, point: str, scope: str = "active"):
    execution_point = svc.require_point(request.user, point)
    return svc.build_board(execution_point, scope=scope, language=current_language())


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
