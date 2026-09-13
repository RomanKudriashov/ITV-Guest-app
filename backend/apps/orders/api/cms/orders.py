"""
CMS: раздел «Заказы» отеля.

Вьюха тонкая — вся работа и все проверки прав в сервисном слое
(`apps/orders/services/registry.py`), как и у остальной CMS: у раздела будет
второй экран (карточка), и правило «не забыть проверку в новой вьюхе» не
работает.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.hotels.services.hotel import current_hotel
from apps.orders.services import registry

router = Router(tags=["cms"])


@router.get("/orders", summary="Заказы отеля: все заведения, фильтры, цифры по выборке")
def list_orders(
    request: HttpRequest,
    point: str = "",
    since: str = "",
    until: str = "",
    status: str = "",
    assignee: str = "",
    order_type: str = "",
    room: str = "",
    search: str = "",
    cursor: str | None = None,
    limit: int | None = None,
):
    """
    `since` / `until` — период В СУТКАХ ОТЕЛЯ по моменту ЗАКРЫТИЯ заказа.
    `point` — заведение; чужое в адресе игнорируется, а не отдаёт отказ.

    Глубоких срезов здесь нет намеренно: они в «Аналитике», и второй их
    экземпляр разошёлся бы с первым.
    """
    return registry.list_orders(
        hotel=current_hotel(),
        language=current_language(),
        point=point,
        since=since,
        until=until,
        status=status,
        assignee=assignee,
        order_type=order_type,
        room=room,
        search=search,
        cursor=cursor,
        limit=limit,
    )
