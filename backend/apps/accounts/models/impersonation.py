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
    # Почта вошедшего — КОПИЕЙ на тенантной строке, а не через связь.
    #
    # `actor` живёт в платформенной части и отелю под RLS не виден: JOIN к
    # нему из запроса отеля отбрасывал сам грант, и баннер молчал. Читать ради
    # баннера платформенным подключением на КАЖДОМ bootstrap — дорого и
    # требует второй базы там, где её быть не должно. Отель имеет право знать,
    # кто у него внутри, поэтому имя лежит рядом с грантом.
    actor_email = models.EmailField(blank=True)
    reason = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    # Кто оборвал сессию: сам вошедший или владелец платформы. Пусто у
    # истёкших по таймеру — «никто не обрывал, вышло время».
    revoked_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Одноразовый код обмена. В консоль уходит ОН, а не сам токен: токен в
    # адресной строке остаётся в истории браузера, в `Referer` и в логах
    # прокси, то есть переживает сессию, ради которой выдан.
    #
    # Хранится ХЭШ: код показывается один раз, как ключ узла. Обмен гасит его
    # (`exchanged_at`), поэтому повторное открытие той же ссылки не работает.
    exchange_code_hash = models.CharField(max_length=64, blank=True, db_index=True)
    exchange_expires_at = models.DateTimeField(null=True, blank=True)
    exchanged_at = models.DateTimeField(null=True, blank=True)

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

    @property
    def code_is_valid(self) -> bool:
        """Код ещё не потрачен и не протух. Одноразовость проверяется здесь."""
        if self.exchanged_at is not None or not self.exchange_code_hash:
            return False
        if self.exchange_expires_at is None or self.exchange_expires_at <= timezone.now():
            return False
        return self.is_valid
