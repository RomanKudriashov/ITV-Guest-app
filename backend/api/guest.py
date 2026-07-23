"""
Гостевая витрина. Контракт — docs/guest-api-contract.md.

Вьюхи тонкие: разобрать запрос, позвать сервис, отдать результат. Вся логика —
в сервисных слоях приложений, доменные ошибки превращает в HTTP общий
обработчик (api/__init__.py).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Header, Router

from apps.accounts.auth import GuestAuth
from apps.accounts.models import TrustLevel
from apps.accounts.services import AuthenticationFailed, create_guest_session
from apps.catalog.offerings import OfferingType
from apps.catalog.services import MenuOptions, build_menu, get_item_detail
from apps.catalog.slots import available_slots
from apps.catalog.models import Item
from apps.core.context import current_language
from apps.core.errors import PermissionDenied
from apps.core.idempotency import IdempotencyConflict, run_idempotent
from apps.hotels.models import Hotel, Location
from apps.orders.services import (
    OrderInput,
    OrderLineInput,
    cancel_order_by_guest,
    create_order,
    get_order,
    list_guest_orders,
    serialize_order,
)

from .schemas import (
    CancelIn,
    ErrorOut,
    GuestSessionIn,
    GuestSessionOut,
    ItemDetailOut,
    LocationsOut,
    MenuOut,
    OrderIn,
    OrderOut,
    OrdersOut,
    RoomNotFoundOut,
)

router = Router(tags=["guest"])
guest_auth = GuestAuth()


# --- Бренд отеля -----------------------------------------------------------


def serialize_hotel(hotel: Hotel) -> dict:
    """
    Отдаём вместе с сессией и вместе с ошибкой «номер не найден»: на экране
    ошибки гость должен видеть бренд своего отеля, а не голую системную
    страницу.
    """
    from apps.hotels.brand_services import get_or_create_brand

    # Тема гарантированно есть: сервис заведёт её из пресета для отеля без
    # темы. Так витрина никогда не падает на платформенные цвета.
    theme = get_or_create_brand(hotel)
    languages = [
        {"code": language.code, "title": language.title or language.code.upper()}
        for language in hotel.hotellanguages.filter(is_active=True).order_by("sort_order")
    ]
    return {
        "id": str(hotel.pk),
        "name": hotel.name,
        "subdomain": hotel.subdomain,
        "currency": hotel.currency,
        "currency_minor_units": hotel.currency_minor_units,
        "timezone": hotel.timezone,
        "default_language": hotel.default_language,
        "languages": languages,
        "theme": (theme.tokens if theme else {}),
    }


def _session_payload(session, hotel: Hotel, *, token: str | None = None) -> dict:
    return {
        "token": token,
        "session_id": str(session.pk),
        "trust": session.trust,
        "expires_at": session.expires_at,
        "language": session.language or hotel.default_language,
        "room": session.room.number if session.room_id else None,
        "hotel": serialize_hotel(hotel),
    }


# --- Сессия ----------------------------------------------------------------


@router.post(
    "/session",
    response={200: GuestSessionOut, 404: RoomNotFoundOut},
    auth=None,
    summary="Создать гостевую сессию (QR или ручной ввод номера)",
)
def create_session(request: HttpRequest, payload: GuestSessionIn):
    hotel = request.hotel
    try:
        issued = create_guest_session(
            room_number=payload.room_number,
            language=payload.language or current_language() or "",
            user_agent=request.headers.get("User-Agent", ""),
        )
    except AuthenticationFailed as exc:
        # Отсканирован старый QR или опечатка при вводе — не «ошибка сервера»,
        # а развилка сценария. Отдаём бренд, чтобы экран остался фирменным.
        return 404, {
            "detail": str(exc),
            "code": "room_not_found",
            "hint": "manual_entry",
            "hotel": serialize_hotel(hotel),
        }

    return 200, _session_payload(issued.session, hotel, token=issued.token)


@router.get(
    "/session", response=GuestSessionOut, auth=guest_auth, summary="Текущая сессия"
)
def read_session(request: HttpRequest):
    return _session_payload(request.guest_session, request.hotel)


# --- Витрина ---------------------------------------------------------------


def _catalog(request: HttpRequest, offering_type: str, include_unavailable: bool):
    return build_menu(
        MenuOptions(
            language=current_language(),
            include_unavailable=include_unavailable,
            offering_type=offering_type,
        ),
        hotel=request.hotel,
    )


@router.get(
    "/catalog",
    response=MenuOut,
    auth=guest_auth,
    summary="Каталог любого типа: еда или заявки-услуги",
)
def get_catalog(
    request: HttpRequest,
    type: str = OfferingType.PRODUCT,
    include_unavailable: bool = True,
):
    """
    Один эндпоинт на все типы предложений — различается только тело позиции.
    Заводить «/services» рядом с «/menu» значило бы удваивать всё, что
    появится дальше: фильтры, локализацию, расписания.
    """
    return _catalog(request, type, include_unavailable)


@router.get(
    "/menu",
    response=MenuOut,
    auth=guest_auth,
    summary="Меню (исторический псевдоним /catalog?type=product)",
)
def get_menu(request: HttpRequest, include_unavailable: bool = True):
    return _catalog(request, OfferingType.PRODUCT, include_unavailable)


@router.get(
    "/item/{item_id}", response=ItemDetailOut, auth=guest_auth, summary="Карточка блюда"
)
def get_item(request: HttpRequest, item_id: str):
    return get_item_detail(item_id, language=current_language())


@router.get("/slots", auth=guest_auth, summary="Свободные слоты позиции на дату")
def get_slots(request: HttpRequest, item_id: str, date: str):
    item = Item.objects.filter(pk=item_id).first()
    if item is None:
        from apps.core.errors import NotFoundError

        raise NotFoundError("Позиция не найдена")
    return available_slots(item, date)


@router.get(
    "/locations", response=LocationsOut, auth=guest_auth, summary="Куда доставить"
)
def get_locations(request: HttpRequest):
    session = request.guest_session
    language = current_language()
    has_room = session.room_id is not None

    locations = []
    for location in Location.objects.filter(is_active=True).order_by("sort_order", "code"):
        # Локация «в номер» бессмысленна для гостя без номера — он пришёл по
        # ссылке без комнаты, и доставлять некуда.
        if location.kind == Location.Kind.IN_ROOM and not has_room:
            continue
        locations.append(
            {
                "id": str(location.pk),
                "code": location.code,
                "kind": location.kind,
                "title": location.tr("title", language),
                "requires_refinement": location.requires_refinement,
                "refinement_label": location.tr("refinement_label", language) or None,
                "is_default": location.kind == Location.Kind.IN_ROOM and has_room,
            }
        )

    return {
        "room": session.room.number if has_room else None,
        "locations": locations,
        "delivery_modes": ["delivery", "pickup"],
    }


# --- Заказ -----------------------------------------------------------------


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
