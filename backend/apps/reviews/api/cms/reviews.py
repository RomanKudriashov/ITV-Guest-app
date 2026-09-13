"""CMS: список отзывов и настройка сбора отзывов."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin

from apps.reviews import services as svc
from apps.reviews.schemas import ReviewSettingsIn

router = Router(tags=["cms:reviews"])


@router.get("/reviews", summary="Отзывы отеля (приватные)")
def list_reviews(request: HttpRequest, rating: int | None = None, limit: int = 100):
    return svc.list_reviews(rating=rating, limit=limit)


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
