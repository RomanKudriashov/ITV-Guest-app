"""
Рабочее место ресепшена: заказ от имени гостя из диалога.

Все ручки — только тем, кто читает чат (ресепшен и администратор).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Header, Router

from apps.chat import services as chat_svc
from apps.chat.services import desk_order
from apps.core.context import current_language
from apps.core.idempotency import IdempotencyConflict, run_idempotent
from apps.chat.schemas import DeskTaskIn
from apps.orders.schemas.guest import OrderIn

router = Router(tags=["tracker-desk"])


def _thread(thread_id):
    chat_svc.require_chat_access()
    return chat_svc.get_thread(thread_id)


def _input(payload: OrderIn):
    from apps.orders.api.guest.orders import _group_locations
    from apps.orders.services import OrderInput, OrderLineInput

    return OrderInput(
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
        group_locations=_group_locations(payload),
        timing=payload.timing,
        requested_time=payload.requested_time,
        comment=payload.comment,
        field_values=payload.field_values or {},
        slot_start=payload.slot_start,
    )


@router.get("/desk/points", summary="Отделы, которым можно передать задачу")
def desk_points(request: HttpRequest):
    chat_svc.require_chat_access()
    return {"points": desk_order.task_points(current_language())}


@router.post("/desk/threads/{thread_id}/task", response={201: dict}, summary="Передать задачу в отдел")
def desk_task(request: HttpRequest, thread_id: str, payload: DeskTaskIn):
    from apps.orders.services import get_order, serialize_order

    thread = _thread(thread_id)
    language = current_language()
    order, title = desk_order.hand_over(
        thread, point_code=payload.point, text=payload.text, user=request.user, language=language
    )
    desk_order.announce_task(thread, title=title, user=request.user)
    return 201, {**serialize_order(get_order(order.pk), language), "point_title": title}


@router.get("/desk/venues", summary="Заведения для заказа за гостя")
def desk_venues(request: HttpRequest):
    chat_svc.require_chat_access()
    return {"venues": desk_order.venues(current_language())}


@router.get("/desk/catalog", summary="Каталог заведения — тот же, что у гостя")
def desk_catalog(request: HttpRequest, point: str, type: str = "product"):
    chat_svc.require_chat_access()
    return desk_order.catalog(current_language(), point=point, offering_type=type)


@router.get("/desk/item/{item_id}", summary="Карточка позиции: модификаторы и поля")
def desk_item(request: HttpRequest, item_id: str):
    from apps.catalog.services.menu import get_item_detail

    chat_svc.require_chat_access()
    return get_item_detail(item_id, language=current_language())


@router.get("/desk/threads/{thread_id}/locations", summary="Места получения — по матрице, для номера гостя")
def desk_locations(request: HttpRequest, thread_id: str, items: str = ""):
    from apps.hotels.services.locations import locations_payload

    thread = _thread(thread_id)
    item_ids = [part for part in items.split(",") if part.strip()]
    return locations_payload(
        language=current_language(), room_number=desk_order.room_number(thread), item_ids=item_ids
    )


@router.post("/desk/threads/{thread_id}/quote", summary="Предпросчёт корзины за гостя")
def desk_quote(request: HttpRequest, thread_id: str, payload: OrderIn):
    from apps.orders.services import quote_cart

    _thread(thread_id)
    data = _input(payload)
    return quote_cart(data)


@router.post(
    "/desk/threads/{thread_id}/order",
    response={201: dict, 200: dict, 400: dict, 409: dict},
    summary="Оформить заказ от имени гостя (идемпотентно)",
)
def desk_place_order(
    request: HttpRequest,
    thread_id: str,
    payload: OrderIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    from apps.orders.services import get_order, serialize_order

    thread = _thread(thread_id)
    if not idempotency_key:
        return 400, {"detail": "Обязателен заголовок Idempotency-Key", "code": "idempotency_key_required"}
    language = current_language()
    data = _input(payload)

    def operation():
        order = desk_order.place(thread, data, user=request.user)
        desk_order.announce(thread, order, user=request.user, language=language)
        return serialize_order(get_order(order.pk), language), order.pk

    try:
        result = run_idempotent(
            scope=f"desk.order.create:{thread.pk}",
            key=idempotency_key,
            request_payload=payload.dict(),
            operation=operation,
        )
    except IdempotencyConflict as exc:
        return 409, {"detail": str(exc), "code": "idempotency_conflict"}
    return (200 if result.replayed else 201), result.value
