"""
Сервисный слой отзывов.

Отзыв приватный: уходит отелю, гостям не показывается. Низкая оценка эмитит
событие — менеджер узнаёт о проблеме через каналы уведомлений, пока гость ещё не
уехал.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Avg, Count, F, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.core import listing
from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.core.fields import translate
from apps.events.bus import REVIEW_CREATED, REVIEW_LOW, emit
from apps.hotels.models import Hotel
from apps.orders.models import Order

from apps.reviews.models import Review


def can_review(order: Order) -> bool:
    """Отзыв возможен на завершённую (не отменённую) заявку без отзыва, если отель их собирает."""
    hotel = order.hotel
    if not hotel.review_enabled:
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
        # Гость видит ответ отеля у своего отзыва — без отметки, дошёл ли он.
        "reply": _reply_payload(review, staff=False),
    }


def get_review(order: Order) -> dict | None:
    review = Review.objects.filter(order=order).first()
    return serialize_review(review) if review else None


def review_points(order: Order) -> list[str]:
    """
    Точки, о работе которых отзыв. У заказа из двух заведений отзыв один — на
    весь заказ, — но разбирают его руководители КАЖДОЙ части: агрегат
    (рум-сервис) сам ничего не готовил.
    """
    children = list(order.children.values_list("execution_point_id", flat=True).distinct())
    return [str(pk) for pk in children] or [str(order.execution_point_id)]


def create_review(order: Order, *, guest_session, rating: int, comment: str = "") -> Review:
    hotel = Hotel.objects.get(pk=order.hotel_id)
    if not hotel.review_enabled:
        # Проверка жила только в `can_review` — прямой запрос мимо витрины
        # оставлял отзыв и при выключенном сборе.
        raise ValidationError("Отель не собирает отзывы", code="reviews_disabled")
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
        low_threshold=hotel.review_low_threshold,
    )

    # Аналитике нужен КАЖДЫЙ отзыв, не только низкий — отдельным событием.
    emit(
        REVIEW_CREATED,
        {"review_id": str(review.pk), "order_id": str(order.pk), "rating": review.rating},
        hotel_id=order.hotel_id,
        actor_type="guest",
    )

    if review.is_low:
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
                "execution_point_ids": review_points(order),
            },
            hotel_id=order.hotel_id,
            actor_type="guest",
        )
    return review


# --- CMS ---------------------------------------------------------------------
#
# Раздел «Отзывы»: список, фильтры, динамика и ответ гостю. Одно правило
# отбора на всё: отзыв о заказе из двух заведений принадлежит КАЖДОЙ части —
# его видит руководитель кухни и руководитель бара, фильтр «Бар» его находит,
# и в динамике бара он учтён. Аналитика кладёт такой отзыв на точку агрегата,
# поэтому динамику раздела считаем здесь, по тем же отзывам, что в списке.


def _touches_points(point_ids) -> Q:
    return Q(order__execution_point_id__in=point_ids) | Q(
        order__children__execution_point_id__in=point_ids
    )


def _parse_day(value, field: str):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValidationError("Дата — в виде ГГГГ-ММ-ДД", field=field, code="bad_date") from exc


def reviews_queryset(*, point_id=None, rating=None, date_from=None, date_to=None):
    from apps.accounts.services.roles import managed_point_ids_or_none
    from apps.hotels.services.hotel import current_hotel

    queryset = Review.objects.all()
    # ОТЗЫВ РЕЖЕТСЯ ПО ТОЧКАМ ЗАКАЗА: управляющий кухней не читает отзывы спа.
    managed = managed_point_ids_or_none()
    if managed is not None:
        queryset = queryset.filter(_touches_points(managed))
    if point_id:
        queryset = queryset.filter(_touches_points([point_id]))

    # «Низкие» — словом, а не списком чисел: порог — настройка отеля, и
    # экран не должен знать его, чтобы попросить именно низкие.
    if rating == "low":
        # По снимку на отзыве: смена порога не переписывает прошлые отзывы.
        queryset = queryset.filter(rating__lte=F("low_threshold"))
    elif rating:
        try:
            wanted = sorted({int(part) for part in str(rating).split(",") if part.strip()})
        except ValueError as exc:
            raise ValidationError("Оценка — числа от 1 до 5", field="rating") from exc
        queryset = queryset.filter(rating__in=wanted)

    # Границы — сутки ОТЕЛЯ, а не сервера: «отзывы за 17-е» у отеля во
    # Владивостоке начинаются в его полночь.
    tz = current_hotel().tzinfo
    frm, to = _parse_day(date_from, "date_from"), _parse_day(date_to, "date_to")
    if frm and to and to < frm:
        raise ValidationError("Начало периода позже конца", field="date_from", code="bad_range")
    if frm:
        queryset = queryset.filter(created_at__gte=datetime.combine(frm, time.min, tzinfo=tz))
    if to:
        queryset = queryset.filter(
            created_at__lt=datetime.combine(to + timedelta(days=1), time.min, tzinfo=tz)
        )
    # Соединение с частями размножает строки — отзыв должен быть один.
    return queryset.distinct()


def guest_reachable(review: Review) -> bool:
    """
    Дойдёт ли ответ: сессия гостя жива. Данных о выезде без PMS нет, и живая
    сессия — единственный честный признак «гость ещё здесь».
    """
    session = review.guest_session
    return bool(
        session is not None
        and session.revoked_at is None
        and session.expires_at > timezone.now()
    )


def _points_of(review: Review, language) -> list[dict]:
    order = review.order
    parts = [child.execution_point for child in order.children.all()]
    points = parts or [order.execution_point]
    seen, result = set(), []
    for point in points:
        if point.pk in seen:
            continue
        seen.add(point.pk)
        result.append({"id": str(point.pk), "title": translate(point.title, language) or point.code})
    return result


def serialize_cms_review(review: Review, language=None) -> dict:
    order = review.order
    return {
        **serialize_review(review),
        "order_number": order.number,
        "room": order.room.number if order.room_id else "",
        "points": _points_of(review, language),
        "is_low": review.is_low,
        "guest_reachable": guest_reachable(review),
        "reply": _reply_payload(review, staff=True),
    }


def list_reviews(
    *, point_id=None, rating=None, date_from=None, date_to=None, limit=None, offset=0, language=None
) -> dict:
    queryset = (
        reviews_queryset(point_id=point_id, rating=rating, date_from=date_from, date_to=date_to)
        .select_related("order__room", "order__execution_point", "order__hotel", "guest_session", "reply_by")
        .prefetch_related("order__children__execution_point")
        .order_by("-created_at", "-pk")
    )
    return listing.page(
        queryset,
        limit=listing.clamp(limit, default=25, maximum=100),
        offset=offset,
        serialize=lambda review: serialize_cms_review(review, language),
    )


def reviews_summary(*, point_id=None, rating=None, date_from=None, date_to=None) -> dict:
    """Средняя в динамике — по дням отеля, тем же отбором, что и список."""
    from apps.hotels.services.hotel import current_hotel

    hotel = current_hotel()
    queryset = reviews_queryset(point_id=point_id, rating=rating, date_from=date_from, date_to=date_to)
    # distinct() и агрегаты не дружат: считаем по id, отобранным без размножения.
    base = Review.objects.filter(pk__in=queryset.values("pk"))
    is_low = Q(rating__lte=F("low_threshold"))
    totals = base.aggregate(count=Count("pk"), avg=Avg("rating"), low=Count("pk", filter=is_low))
    by_day = (
        base.annotate(day=TruncDate("created_at", tzinfo=hotel.tzinfo))
        .values("day")
        .annotate(count=Count("pk"), avg=Avg("rating"), low=Count("pk", filter=is_low))
        .order_by("day")
    )
    count = totals["count"] or 0
    return {
        "count": count,
        "avg_rating": round(totals["avg"], 2) if totals["avg"] is not None else None,
        "low": totals["low"] or 0,
        "low_rate": round((totals["low"] or 0) / count, 4) if count else None,
        # Текущий порог — для подписи; сами отзывы считаются по своему снимку.
        "low_threshold": hotel.review_low_threshold,
        "trend": [
            {
                "day": row["day"].isoformat(),
                "count": row["count"],
                "avg_rating": round(row["avg"], 2),
                "low": row["low"],
            }
            for row in by_day
        ],
    }


def get_cms_review(review_id) -> Review:
    try:
        return (
            reviews_queryset()
            .select_related("order__room", "order__execution_point", "order__hotel", "guest_session", "reply_by")
            .get(pk=review_id)
        )
    except (Review.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise NotFoundError("Отзыв не найден") from exc


def reply_to_review(review_id, *, user, text: str) -> dict:
    """
    Ответ гостю. Живая сессия — ответ уходит сообщением в чат гостя и
    хранится на отзыве. Мёртвая — только хранится: экран предупредил заранее,
    и `reply.delivered = false` не даст решить, что гость ответ получил.
    """
    text = (text or "").strip()
    if not text:
        raise ValidationError("Пустой ответ", field="text")
    if len(text) > 2000:
        raise ValidationError("Ответ длиннее 2000 символов", field="text")

    review = get_cms_review(review_id)
    with transaction.atomic():
        locked = Review.objects.select_for_update().get(pk=review.pk)
        if locked.reply_at is not None:
            raise ConflictError("На этот отзыв уже ответили", code="reply_exists")
        delivered = guest_reachable(review)
        if delivered:
            from apps.chat.services import threads

            threads.staff_send(threads.get_or_create_thread(review.guest_session), user, text)
        Review.objects.filter(pk=review.pk).update(
            reply_text=text, reply_at=timezone.now(), reply_by=user, reply_delivered=delivered
        )
    return serialize_cms_review(get_cms_review(review.pk))


def _reply_payload(review: Review, *, staff: bool) -> dict | None:
    if review.reply_at is None:
        return None
    payload = {"text": review.reply_text, "at": review.reply_at.isoformat()}
    if staff:
        author = review.reply_by
        payload["by"] = (author.full_name or author.email) if author else ""
        payload["delivered"] = review.reply_delivered
    return payload


def settings_payload(hotel) -> dict:
    """Настройка сбора отзывов. Перенос дословный из вьюхи."""
    return {"enabled": hotel.review_enabled, "low_rating_threshold": hotel.review_low_threshold}


def get_settings() -> dict:
    from apps.hotels.services.hotel import current_hotel

    return settings_payload(current_hotel())


def update_settings(*, enabled: bool | None, low_rating_threshold: int | None) -> dict:
    from apps.hotels.services.hotel import current_hotel

    hotel = current_hotel()
    if enabled is not None:
        hotel.review_enabled = enabled
    if low_rating_threshold is not None:
        hotel.review_low_threshold = max(1, min(5, low_rating_threshold))
    hotel.save(update_fields=["review_enabled", "review_low_threshold", "updated_at"])
    return settings_payload(hotel)
