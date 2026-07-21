"""
Дымовые гостевые эндпоинты.

Их задача — не полнота API, а доказательство, что фундамент работает:
сессия → меню → заказ → статус, с изоляцией тенантов, локализацией,
расписанием, идемпотентностью и событием в шину.

Вьюхи намеренно тонкие: вся логика в сервисных слоях приложений.
"""

from __future__ import annotations

from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from ninja import Header, Router

from apps.accounts.auth import GuestAuth
from apps.accounts.services import AuthenticationFailed, create_guest_session
from apps.catalog.services import MenuOptions, build_menu
from apps.core.context import current_language
from apps.core.idempotency import IdempotencyConflict, run_idempotent
from apps.orders.models import Order
from apps.orders.services import (
    OrderInput,
    OrderLineInput,
    OrderValidationError,
    RoutingError,
    create_order,
    serialize_order,
)

from .schemas import (
    ErrorOut,
    GuestSessionIn,
    GuestSessionOut,
    MenuOut,
    OrderIn,
    OrderOut,
)

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.post(
    "/session",
    response={200: GuestSessionOut, 400: ErrorOut},
    auth=None,
    summary="Создать гостевую сессию по номеру комнаты",
)
def create_session(request: HttpRequest, payload: GuestSessionIn):
    try:
        issued = create_guest_session(
            room_number=payload.room_number,
            language=payload.language or current_language() or "",
            user_agent=request.headers.get("User-Agent", ""),
        )
    except AuthenticationFailed as exc:
        return 400, {"detail": str(exc), "code": "room_not_found"}

    hotel = request.hotel
    return 200, {
        "token": issued.token,
        "session_id": str(issued.session.pk),
        "trust": issued.session.trust,
        "expires_at": issued.session.expires_at,
        "hotel": {
            "id": str(hotel.pk),
            "name": hotel.name,
            "subdomain": hotel.subdomain,
            "currency": hotel.currency,
            "default_language": hotel.default_language,
            "timezone": hotel.timezone,
        },
        "room": issued.session.room.number if issued.session.room_id else None,
    }


@router.get(
    "/menu",
    response=MenuOut,
    auth=guest_auth,
    summary="Меню отеля: локализованное, с учётом расписания",
)
def get_menu(request: HttpRequest, include_unavailable: bool = True):
    return build_menu(
        MenuOptions(
            language=current_language(),
            include_unavailable=include_unavailable,
        )
    )


@router.post(
    "/order",
    response={201: OrderOut, 200: OrderOut, 400: ErrorOut, 409: ErrorOut},
    auth=guest_auth,
    summary="Создать заказ (идемпотентно по Idempotency-Key)",
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
        location_id=payload.location_id,
        location_refinement=payload.location_refinement,
        delivery_mode=payload.delivery_mode,
        requested_time=payload.requested_time,
        comment=payload.comment,
    )

    def operation():
        order = create_order(data, guest_session=session)
        return serialize_order(order, current_language()), order.pk

    try:
        result = run_idempotent(
            scope="guest.order.create",
            key=idempotency_key,
            request_payload=payload.dict(),
            operation=operation,
        )
    except IdempotencyConflict as exc:
        return 409, {"detail": str(exc), "code": "idempotency_conflict"}
    except (OrderValidationError, RoutingError) as exc:
        return 400, {"detail": str(exc), "code": "order_rejected"}

    return (200 if result.replayed else 201), result.value


@router.get(
    "/order/{order_id}",
    response={200: OrderOut, 404: ErrorOut},
    auth=guest_auth,
    summary="Статус заказа",
)
def get_order(request: HttpRequest, order_id: str):
    order = get_object_or_404(
        Order.objects.select_related("status", "room", "location").prefetch_related("items"),
        pk=order_id,
        guest_session_id=request.guest_session.pk,
    )
    return 200, serialize_order(order, current_language())
