"""Вход платформы в отель под аудитом: грант с таймером."""

from __future__ import annotations

from django.utils import timezone

from django.db import models

from apps.core.managers import AllObjectsManager, BaseManager
from apps.core.models import BaseModel

from .guest import GuestSession

from .user import User


class ImpersonationGrant(BaseModel):
    """
    Вход поддержки под чужой личиной. Каркас: сам механизм выдачи/проверки
    есть, UI и политика согласования — позже.

    Инвариант: ни одно действие под impersonation не должно быть неотличимо от
    действия настоящего пользователя. Поэтому в JWT кладётся клейм `imp`, а в
    AuditLog — поле impersonated_by.
    """

    hotel = models.ForeignKey(
        "hotels.Hotel", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    actor = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="impersonations_started"
    )
    target_user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="impersonations_received",
    )
    target_guest_session = models.ForeignKey(
        GuestSession, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    reason = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects = BaseManager()
    all_objects = AllObjectsManager()

    class Meta:
        db_table = "accounts_impersonation_grant"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.actor_id} → {self.target_user_id or self.target_guest_session_id}"

    @property
    def is_valid(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()
