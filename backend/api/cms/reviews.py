"""CMS: список отзывов и настройка сбора отзывов."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

from apps.hotels.models import Hotel
from apps.core.context import require_hotel_id
from apps.reviews import services as svc

router = Router(tags=["cms:reviews"])


class ReviewSettingsIn(Schema):
    enabled: bool | None = None
    low_rating_threshold: int | None = None


@router.get("/reviews", summary="Отзывы отеля (приватные)")
def list_reviews(request: HttpRequest, rating: int | None = None, limit: int = 100):
    return svc.list_reviews(rating=rating, limit=limit)


@router.get("/review-settings", summary="Настройка сбора отзывов")
def get_settings(request: HttpRequest):
    hotel = Hotel.objects.get(pk=require_hotel_id())
    return {"enabled": hotel.review_enabled, "low_rating_threshold": hotel.review_low_threshold}


@router.patch("/review-settings", summary="Изменить настройку отзывов")
def patch_settings(request: HttpRequest, payload: ReviewSettingsIn):
    hotel = Hotel.objects.get(pk=require_hotel_id())
    if payload.enabled is not None:
        hotel.review_enabled = payload.enabled
    if payload.low_rating_threshold is not None:
        hotel.review_low_threshold = max(1, min(5, payload.low_rating_threshold))
    hotel.save(update_fields=["review_enabled", "review_low_threshold", "updated_at"])
    return {"enabled": hotel.review_enabled, "low_rating_threshold": hotel.review_low_threshold}
