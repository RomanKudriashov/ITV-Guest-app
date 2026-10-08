"""
Операции персонала над заказами.

Живёт вне /api/guest, потому что это действия сотрудника, а не гостя.

СМЕНЫ СТАТУСА ЗДЕСЬ НЕТ (партия 46). `POST /orders/{id}/status` была обходной
дверью: любой сотрудник отеля менял любой статус любому заказу — без проверки
точки и без проверки переходов. Интерфейс её не звал. Статус меняется только
ручками трекера (`/tracker/order/{id}/accept|status|cancel`) — с теми же
проверками, что у людей.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router
from apps.orders.schemas.guest import OrderOut

from apps.core.context import current_language
from apps.orders.services import get_order, serialize_order


router = Router(tags=["orders"])


@router.get("/{order_id}", response=OrderOut, summary="Заказ глазами персонала")
def read_order(request: HttpRequest, order_id: str):
    return serialize_order(get_order(order_id), current_language())
