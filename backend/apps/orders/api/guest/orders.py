"""
Корзина и заявки гостя. Контракт — docs/guest-api-contract.md.

Вьюхи тонкие: разобрать запрос, позвать сервис, отдать результат.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Header, Router

from apps.accounts.models import TrustLevel
from apps.accounts.services.auth import GuestAuth
from apps.core.context import current_language
from apps.core.errors import PermissionDenied
from apps.core.idempotency import IdempotencyConflict, run_idempotent
from apps.core.schemas import ErrorOut
from apps.orders.schemas.guest import CancelIn, OrderIn, OrderOut, OrdersOut
from apps.orders.services import (
    OrderInput,
    OrderLineInput,
    cancel_order_by_guest,
    create_order,
    get_order,
    list_guest_orders,
    serialize_order,
)

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.post(
    "/cart/quote",
    auth=guest_auth,
    summary="Предпросчёт корзины: суммы, минимум, блокировка (без создания заказа)",
)
def cart_quote(request: HttpRequest, payload: OrderIn):
    from apps.orders.services import quote_cart

    data = OrderInput(
        lines=[
            OrderLineInput(
                item_id=line.item_id,
                quantity=line.quantity,
                modifier_option_ids=line.modifier_option_ids,
                comment=line.comment,
            )
            for line in payload.lines
        ],
        service_code=payload.service_code,
        location_id=payload.location_id,
        delivery_mode=payload.delivery_mode,
        tip_minor=payload.tip_minor,
        tip_percent=payload.tip_percent,
    )
    return quote_cart(data)


@router.post(
    "/order",
    response={201: OrderOut, 200: OrderOut, 400: ErrorOut, 409: ErrorOut},
    auth=guest_auth,
    summary="Оформить заказ (идемпотентно по Idempotency-Key)",
)
def place_order(
    request: HttpRequest,
    payload: OrderIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """
    Повтор с тем же Idempotency-Key возвращает 200 и тот же заказ; первый
    вызов — 201. Ключ обязателен: мобильная сеть и нетерпеливый гость
    гарантируют повторные отправки.
    """
    if not idempotency_key:
        return 400, {
            "detail": "Обязателен заголовок Idempotency-Key",
            "code": "idempotency_key_required",
        }

    session = request.guest_session
    if not session.has_trust(TrustLevel.ROOM_SCANNED):
        # Заказ без номера некуда доставить и не с кем связать. Смотреть меню
        # при этом можно — доверие ограничивает действия, а не просмотр.
        raise PermissionDenied(
            "Чтобы оформить заказ, укажите номер", code="trust_required"
        )

    data = OrderInput(
        lines=[
            OrderLineInput(
                item_id=line.item_id,
                quantity=line.quantity,
                modifier_option_ids=line.modifier_option_ids,
                comment=line.comment,
            )
            for line in payload.lines
        ],
        service_code=payload.service_code,
        location_id=payload.location_id,
        location_refinement=payload.location_refinement,
        delivery_mode=payload.delivery_mode,
        timing=payload.timing,
        requested_time=payload.requested_time,
        comment=payload.comment,
        field_values=payload.field_values or {},
        slot_start=payload.slot_start,
        tip_minor=payload.tip_minor,
        tip_percent=payload.tip_percent,
    )

    def operation():
        order = create_order(data, guest_session=session)
        return serialize_order(get_order(order.pk), current_language()), order.pk

    try:
        result = run_idempotent(
            scope="guest.order.create",
            key=idempotency_key,
            request_payload=payload.dict(),
            operation=operation,
        )
    except IdempotencyConflict as exc:
        return 409, {"detail": str(exc), "code": "idempotency_conflict"}

    return (200 if result.replayed else 201), result.value


@router.get("/orders", response=OrdersOut, auth=guest_auth, summary="История заявок")
def list_orders(request: HttpRequest):
    return list_guest_orders(request.guest_session, current_language())


@router.get("/orders/active", auth=guest_auth, summary="Активные заказы гостя (для стартовой)")
def list_active(request: HttpRequest):
    from apps.orders.services import list_active_orders

    return list_active_orders(request.guest_session, current_language())


@router.get(
    "/order/{order_id}", response=OrderOut, auth=guest_auth, summary="Заявка и её статус"
)
def read_order(request: HttpRequest, order_id: str):
    order = get_order(order_id, guest_session=request.guest_session)
    return serialize_order(order, current_language())


@router.post(
    "/order/{order_id}/cancel",
    response={200: OrderOut, 409: ErrorOut},
    auth=guest_auth,
    summary="Отменить заявку, если статус позволяет",
)
def cancel_order(request: HttpRequest, order_id: str, payload: CancelIn):
    session = request.guest_session
    order = get_order(order_id, guest_session=session)
    cancelled = cancel_order_by_guest(order, guest_session=session, reason=payload.reason)
    return 200, serialize_order(cancelled, current_language())
