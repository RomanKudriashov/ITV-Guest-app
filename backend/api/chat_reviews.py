"""
Гостевые и персональные эндпоинты чата, отзывов и главной.
Контракт — docs/guest-surface-api-contract.md.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest
from ninja import Router, Schema

from apps.accounts.auth import GuestAuth, StaffAuth
from apps.catalog.models import Category
from apps.catalog.offerings import OfferingType
from apps.chat import services as chat_svc
from apps.core.context import current_language
from apps.core.errors import NotFoundError
from apps.core.fields import translate
from apps.hotels.models import Hotel
from apps.orders.services import get_order
from apps.reviews import services as review_svc

guest_router = Router(tags=["guest-surface"])
tracker_router = Router(tags=["tracker-chat"])
guest_auth = GuestAuth()


# --- Схемы -----------------------------------------------------------------


class MessageIn(Schema):
    body: str


class ReviewIn(Schema):
    rating: int
    comment: str = ""


# --- Главная (гость) -------------------------------------------------------

# type секции → маршрут витрины. Единственное место, где тип связан с UI-путём;
# сам набор секций строится из данных отеля.
_SECTION_META = {
    OfferingType.PRODUCT: ("product", "Ресторан", "/menu"),
    OfferingType.SERVICE_REQUEST: ("service", "Услуги", "/services"),
    OfferingType.SLOT: ("slot", "Бронь", "/slots"),
    OfferingType.INFO: ("info", "Информация", "/info"),
}


@guest_router.get("/home", auth=guest_auth, summary="Главная: секции отеля из данных")
def guest_home(request: HttpRequest):
    language = current_language()
    hotel = request.hotel

    counts: dict[str, int] = {}
    for row in (
        Category.objects.filter(is_active=True).values("type").order_by()
    ):
        counts[row["type"]] = counts.get(row["type"], 0) + 1

    sections = []
    for offering_type, (code, title, route) in _SECTION_META.items():
        count = Category.objects.filter(type=offering_type, is_active=True).count()
        if count:
            sections.append(
                {"type": offering_type, "code": code, "title": title, "category_count": count, "route": route}
            )

    thread = chat_svc.get_or_create_thread(request.guest_session)
    unread = chat_svc.thread_snapshot(thread, side="guest")["unread"]

    from apps.catalog.home import quick_actions_for

    return {
        "hotel": {"name": hotel.name, "subdomain": hotel.subdomain},
        "room": request.guest_session.room.number if request.guest_session.room_id else None,
        "sections": sections,
        "unread_chat": unread,
        # Быстрые действия (A3+ шаг 4): набор отеля или дефолт по наличию разделов.
        "quick_actions": quick_actions_for(hotel, language),
    }


# --- Чат (гость) -----------------------------------------------------------


@guest_router.get("/chat", auth=guest_auth, summary="Тред гостя")
def guest_chat(request: HttpRequest):
    thread = chat_svc.get_or_create_thread(request.guest_session)
    return chat_svc.thread_snapshot(thread, side="guest")


@guest_router.post("/chat", auth=guest_auth, summary="Отправить сообщение")
def guest_chat_send(request: HttpRequest, payload: MessageIn):
    return chat_svc.guest_send(request.guest_session, payload.body)


@guest_router.post("/chat/read", auth=guest_auth, summary="Отметить прочитанными")
def guest_chat_read(request: HttpRequest):
    thread = chat_svc.get_or_create_thread(request.guest_session)
    chat_svc.mark_read(thread, side="guest")
    return chat_svc.thread_snapshot(thread, side="guest")


# --- Отзыв (гость) ---------------------------------------------------------


@guest_router.get("/order/{order_id}/review", auth=guest_auth, summary="Отзыв на заявку")
def guest_get_review(request: HttpRequest, order_id: str):
    order = get_order(order_id, guest_session=request.guest_session)
    review = review_svc.get_review(order)
    # Отзыва ещё нет — это сценарий «не оценивал», а не ошибка. Отдаём 404,
    # чтобы витрина показала форму, а не пустой «уже оставленный» отзыв.
    if review is None:
        raise NotFoundError("Отзыв ещё не оставлен")
    return review


@guest_router.post(
    "/order/{order_id}/review",
    response={201: dict, 409: dict, 422: dict},
    auth=guest_auth,
    summary="Оставить отзыв (один на заявку)",
)
def guest_post_review(request: HttpRequest, order_id: str, payload: ReviewIn):
    order = get_order(order_id, guest_session=request.guest_session)
    review = review_svc.create_review(
        order, guest_session=request.guest_session, rating=payload.rating, comment=payload.comment
    )
    return 201, review_svc.serialize_review(review)


# --- Чат (персонал) --------------------------------------------------------


@tracker_router.get("/chat/threads", summary="Треды отеля")
def staff_threads(request: HttpRequest):
    return chat_svc.list_threads()


@tracker_router.get("/chat/threads/{thread_id}", summary="Тред с сообщениями")
def staff_thread(request: HttpRequest, thread_id: str):
    thread = chat_svc.get_thread(thread_id)
    return chat_svc.thread_snapshot(thread, side="staff")


@tracker_router.post("/chat/threads/{thread_id}", summary="Ответить в тред")
def staff_thread_send(request: HttpRequest, thread_id: str, payload: MessageIn):
    thread = chat_svc.get_thread(thread_id)
    return chat_svc.staff_send(thread, request.user, payload.body)


@tracker_router.post("/chat/threads/{thread_id}/read", summary="Отметить прочитанными")
def staff_thread_read(request: HttpRequest, thread_id: str):
    thread = chat_svc.get_thread(thread_id)
    chat_svc.mark_read(thread, side="staff")
    return chat_svc.thread_snapshot(thread, side="staff")
