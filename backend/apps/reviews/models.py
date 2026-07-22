"""
Отзывы: приватные по умолчанию.

Оценка уходит отелю (видно в трекере и CMS), гостям НЕ публикуется. Это
осознанное решение против антипаттерна «витрина отзывов»: негатив должен
попасть менеджеру и быть исправлен до отъезда гостя, а не улететь в публичный
рейтинг.
"""

from __future__ import annotations

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TenantModel


class Review(TenantModel):
    order = models.OneToOneField(
        "orders.Order", on_delete=models.CASCADE, related_name="review"
    )
    guest_session = models.ForeignKey(
        "accounts.GuestSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviews",
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField(blank=True)
    # Уведомили ли менеджера о низкой оценке — чтобы не дёргать повторно.
    low_rating_notified = models.BooleanField(default=False)

    class Meta:
        db_table = "reviews_review"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["hotel", "rating", "-created_at"])]

    def __str__(self) -> str:
        return f"review:{self.order_id} {self.rating}★"
