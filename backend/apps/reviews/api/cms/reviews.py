"""
CMS: раздел «Отзывы» — список, динамика, ответ гостю; настройка сбора отзывов.

Раздел открыт тем, кому открыт CMS: администратору отеля и руководителям
заведений (каждый видит отзывы своих заведений). Линейный персонал в CMS не
входит вовсе.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import current_language

from apps.reviews import services as svc
from apps.reviews.schemas import ReviewReplyIn, ReviewSettingsIn

router = Router(tags=["cms:reviews"])


@router.get("/reviews", summary="Отзывы отеля (приватные): фильтры и листание")
def list_reviews(
    request: HttpRequest,
    point_id: str | None = None,
    rating: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int | None = None,
    offset: int = 0,
):
    return svc.list_reviews(
        point_id=point_id,
        rating=rating,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        language=current_language(),
    )


@router.get("/reviews/summary", summary="Средняя оценка в динамике — тем же отбором, что список")
def reviews_summary(
    request: HttpRequest,
    point_id: str | None = None,
    rating: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    return svc.reviews_summary(
        point_id=point_id, rating=rating, date_from=date_from, date_to=date_to
    )


@router.get("/reviews/{review_id}", summary="Расследование отзыва — всё на одном экране")
def investigate(request: HttpRequest, review_id: str):
    from apps.reviews.services.investigation import investigation

    return investigation(review_id, language=current_language())


@router.post("/reviews/{review_id}/reply", summary="Ответить гостю")
def reply(request: HttpRequest, review_id: str, payload: ReviewReplyIn):
    return svc.reply_to_review(review_id, user=request.user, text=payload.text)


@router.get("/review-settings", summary="Настройка сбора отзывов")
def get_settings(request: HttpRequest):
    # Собирать ли отзывы и с какого балла считать низким — политика отеля, а не
    # заведения: у гостя один экран отзыва на всю поездку.
    require_hotel_admin()
    return svc.get_settings()


@router.patch("/review-settings", summary="Изменить настройку отзывов")
def patch_settings(request: HttpRequest, payload: ReviewSettingsIn):
    require_hotel_admin()
    return svc.update_settings(
        enabled=payload.enabled, low_rating_threshold=payload.low_rating_threshold
    )
