"""Схемы отзывов."""

from __future__ import annotations

from ninja import Schema


class ReviewIn(Schema):
    rating: int
    comment: str = ""


class ReviewSettingsIn(Schema):
    enabled: bool | None = None
    low_rating_threshold: int | None = None
