"""
Операции персонала над заказами.

Живёт вне /api/guest, потому что это действия сотрудника, а не гостя. UI
трекера — следующий прогон; сейчас эндпоинт нужен, чтобы живой статус у гостя
был настоящим и проверяемым тестом, а не имитацией.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.orders.services import change_status, get_order, serialize_order

from .schemas import OrderOut, StatusChangeIn

router = Router(tags=["orders"])


@router.post(
    "/{order_id}/status",
    response=OrderOut,
    summary="Сменить статус заказа (переиспользуется трекером)",
)
def set_status(request: HttpRequest, order_id: str, payload: StatusChangeIn):
    order = get_order(order_id)
    updated = change_status(
        order,
        to_code=payload.status,
        actor_type="staff",
        actor_id=getattr(request.user, "pk", None),
        comment=payload.comment,
    )
    return serialize_order(updated, current_language())


@router.get("/{order_id}", response=OrderOut, summary="Заказ глазами персонала")
def read_order(request: HttpRequest, order_id: str):
    return serialize_order(get_order(order_id), current_language())
