"""Отзыв гостя на заявку. Контракт — docs/guest-surface-api-contract.md."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.core.errors import NotFoundError
from apps.orders.services import get_order
from apps.reviews import services as review_svc
from apps.reviews.schemas import ReviewIn

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


# --- Отзыв (гость) ---------------------------------------------------------


@router.get("/order/{order_id}/review", auth=guest_auth, summary="Отзыв на заявку")
def guest_get_review(request: HttpRequest, order_id: str):
    order = get_order(order_id, guest_session=request.guest_session)
    review = review_svc.get_review(order)
    # Отзыва ещё нет — это сценарий «не оценивал», а не ошибка. Отдаём 404,
    # чтобы витрина показала форму, а не пустой «уже оставленный» отзыв.
    if review is None:
        raise NotFoundError("Отзыв ещё не оставлен")
    return review


@router.post(
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
