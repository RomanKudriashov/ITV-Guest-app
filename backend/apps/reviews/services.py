"""
Сервисный слой отзывов.

Отзыв приватный: уходит отелю, гостям не показывается. Низкая оценка эмитит
событие — менеджер узнаёт о проблеме через каналы прогона 6, пока гость ещё не
уехал.
"""

from __future__ import annotations

from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, ValidationError
from apps.events.bus import REVIEW_CREATED, REVIEW_LOW, emit
from apps.hotels.models import Hotel
from apps.orders.models import Order

from .models import Review


def can_review(order: Order) -> bool:
    """Отзыв возможен на завершённую (не отменённую) заявку без отзыва, если отель их собирает."""
    hotel = order.hotel
    if not getattr(hotel, "review_enabled", True):
        return False
    if not order.status.is_terminal or order.status.is_cancelled:
        return False
    return not Review.all_objects.filter(order=order).exists()


def serialize_review(review: Review) -> dict:
    return {
        "id": str(review.pk),
        "order_id": str(review.order_id),
        "rating": review.rating,
        "comment": review.comment,
        "created_at": review.created_at.isoformat(),
    }


def get_review(order: Order) -> dict | None:
    review = Review.objects.filter(order=order).first()
    return serialize_review(review) if review else None


def create_review(order: Order, *, guest_session, rating: int, comment: str = "") -> Review:
    if not (order.status.is_terminal and not order.status.is_cancelled):
        raise ValidationError(
            "Оценить можно только завершённую заявку", code="review_not_allowed"
        )
    if not (1 <= int(rating) <= 5):
        raise ValidationError("Оценка от 1 до 5", field="rating")
    if Review.all_objects.filter(order=order).exists():
        # Один отзыв на заказ — идемпотентно.
        raise ConflictError("Отзыв уже оставлен", code="review_exists")

    review = Review.objects.create(
        hotel_id=require_hotel_id(),
        order=order,
        guest_session=guest_session,
        rating=int(rating),
        comment=(comment or "").strip()[:2000],
    )

    # Аналитике нужен КАЖДЫЙ отзыв, не только низкий — отдельным событием.
    emit(
        REVIEW_CREATED,
        {"review_id": str(review.pk), "order_id": str(order.pk), "rating": review.rating},
        hotel_id=order.hotel_id,
        actor_type="guest",
    )

    hotel = Hotel.objects.get(pk=order.hotel_id)
    if review.rating <= getattr(hotel, "review_low_threshold", 3):
        # Service recovery: разбудить менеджера до отъезда гостя.
        emit(
            REVIEW_LOW,
            {
                "order_id": str(order.pk),
                "number": order.number,
                "rating": review.rating,
                "comment": review.comment[:200],
                "room": order.room.number if order.room_id else "",
                "execution_point_id": str(order.execution_point_id),
            },
            hotel_id=order.hotel_id,
            actor_type="guest",
        )
    return review


# --- CMS -------------------------------------------------------------------


def list_reviews(*, rating: int | None = None, limit: int = 100) -> list[dict]:
    queryset = Review.objects.select_related("order").order_by("-created_at")
    if rating:
        queryset = queryset.filter(rating=rating)
    return [
        {
            **serialize_review(review),
            "order_number": review.order.number,
        }
        for review in queryset[: min(int(limit or 100), 500)]
    ]
