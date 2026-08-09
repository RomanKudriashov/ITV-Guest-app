"""Сборка эндпоинтов отзывов."""

from __future__ import annotations

from .cms import reviews as cms_reviews
from .guest import review as guest_review

guest_router = guest_review.router
cms_router = cms_reviews.router

__all__ = ["cms_router", "guest_router"]
