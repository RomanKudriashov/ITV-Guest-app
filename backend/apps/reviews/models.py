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
    # Порог «низкая» НА МОМЕНТ ОТЗЫВА. Отель может сменить порог, но прошлое
    # от этого не меняется: отзыв, бывший низким, низким и остаётся.
    low_threshold = models.PositiveSmallIntegerField(null=True, blank=True)

    # Ответ отеля — один на отзыв. `reply_delivered` — ушёл ли он гостю в чат:
    # сессия гостя могла уже умереть, и тогда ответ только хранится здесь.
    reply_text = models.TextField(blank=True)
    reply_at = models.DateTimeField(null=True, blank=True)
    reply_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reply_delivered = models.BooleanField(default=False)

    class Meta:
        db_table = "reviews_review"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["hotel", "rating", "-created_at"])]

    def save(self, *args, **kwargs):
        # Снимок порога ставится ВСЕГДА, кто бы ни создавал отзыв: сервис,
        # сев или тест. Забытый снимок молча сделал бы отзыв «не низким».
        if self.low_threshold is None and self.hotel_id:
            from apps.hotels.models import Hotel

            self.low_threshold = (
                Hotel.objects.filter(pk=self.hotel_id)
                .values_list("review_low_threshold", flat=True)
                .first()
            )
        super().save(*args, **kwargs)

    @property
    def is_low(self) -> bool:
        return self.low_threshold is not None and self.rating <= self.low_threshold

    def __str__(self) -> str:
        return f"review:{self.order_id} {self.rating}/5"
