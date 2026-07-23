"""
Кто и на каком основании работает с системой.

Три принципиально разных субъекта:
  * персонал отеля  — User + JWT (stateless);
  * гость           — GuestSession + непрозрачный токен с уровнем доверия;
  * платформа       — User с hotel=NULL, отдельный скоуп.

Уровень доверия гостя (trust) — не украшение, а то, от чего зависят права:
отсканировал QR в номере → можно смотреть меню и заказывать; подтверждён по
PMS → можно писать на счёт номера; и т.д. Проверки прав опираются на trust,
а не на «есть ли токен».
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.core.managers import AllObjectsManager, BaseManager
from apps.core.models import BaseModel, TenantModel


class TrustLevel(models.TextChoices):
    """Порядок важен — сравнение идёт по рангу, см. TRUST_RANK."""

    ANONYMOUS = "anonymous", "Аноним (открыл ссылку)"
    ROOM_SCANNED = "room_scanned", "Отсканировал QR в номере"
    PMS_VERIFIED = "pms_verified", "Подтверждён по брони в PMS"
    STAFF_VERIFIED = "staff_verified", "Подтверждён сотрудником"


TRUST_RANK: dict[str, int] = {
    TrustLevel.ANONYMOUS: 0,
    TrustLevel.ROOM_SCANNED: 10,
    TrustLevel.PMS_VERIFIED: 20,
    TrustLevel.STAFF_VERIFIED: 30,
}


class UserManager(BaseManager):
    def create_user(self, email: str, password: str | None = None, **extra):
        if not email:
            raise ValueError("Нужен email")
        user = self.model(email=self.normalize_email(email), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra):
        extra.setdefault("is_platform_admin", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_staff_member", True)
        extra.setdefault("hotel", None)
        return self.create_user(email, password, **extra)

    @staticmethod
    def normalize_email(email: str) -> str:
        return email.strip().lower()


class User(AbstractBaseUser, PermissionsMixin, BaseModel):
    """
    Сотрудник отеля либо платформенный администратор.

    hotel = NULL означает платформенный уровень. Такие строки не видны роли
    приложения из-за RLS — платформенный вход идёт через connection
    платформенной роли (.using("platform")).
    """

    hotel = models.ForeignKey(
        "hotels.Hotel",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="users",
    )
    email = models.EmailField(max_length=254, unique=True)
    full_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    language = models.CharField(max_length=8, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff_member = models.BooleanField(default=True, help_text="Сотрудник отеля")
    is_hotel_admin = models.BooleanField(default=False, help_text="Админ отеля")
    is_platform_admin = models.BooleanField(default=False, help_text="Супер-админ платформы")

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()
    all_objects = AllObjectsManager()

    class Meta:
        db_table = "accounts_user"
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email

    @property
    def is_staff(self) -> bool:
        # Совместимость с django.contrib.auth — своей админки у нас нет.
        return self.is_platform_admin


class StaffAssignment(TenantModel):
    """
    Кто какие точки исполнения обслуживает. Отсюда берётся, в какие каналы
    трекера подписывать сотрудника и кому падает уведомление о заказе.
    """

    class Level(models.TextChoices):
        MEMBER = "member", "Исполнитель"
        LEAD = "lead", "Старший смены"
        MANAGER = "manager", "Руководитель"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="assignments")
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint", on_delete=models.CASCADE, related_name="assignments"
    )
    level = models.CharField(max_length=16, choices=Level.choices, default=Level.MEMBER)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "accounts_staff_assignment"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "user", "execution_point"], name="uniq_staff_assignment"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.execution_point_id} ({self.level})"


class GuestSession(TenantModel):
    """
    Гостевая сессия. Токен непрозрачный (не JWT) и отзываемый: гость приходит
    с чужого устройства, по QR, без регистрации — состояние на сервере здесь
    важнее stateless-удобства.

    В базе лежит только SHA-256 от токена. Сам токен возвращается клиенту один
    раз, при создании сессии.
    """

    room = models.ForeignKey(
        "hotels.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="sessions"
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    trust = models.CharField(
        max_length=32, choices=TrustLevel.choices, default=TrustLevel.ANONYMOUS
    )
    language = models.CharField(max_length=8, blank=True)
    # Ссылка на гостя в PMS, когда он подтверждён. Не FK: PMS внешняя система.
    guest_ref = models.CharField(max_length=128, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)

    class Meta:
        db_table = "accounts_guest_session"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"guest:{self.pk} room={self.room_id} trust={self.trust}"

    # --- Токен ---------------------------------------------------------

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @classmethod
    def issue_token(cls) -> tuple[str, str]:
        """Возвращает (сырой токен, его хэш). Сырой нигде не сохраняем."""
        token = secrets.token_urlsafe(32)
        return token, cls.hash_token(token)

    @classmethod
    def default_expiry(cls):
        return timezone.now() + timedelta(hours=settings.GUEST_SESSION_TTL_HOURS)

    # --- Состояние -----------------------------------------------------

    @property
    def is_valid(self) -> bool:
        return (
            self.revoked_at is None
            and self.deleted_at is None
            and self.expires_at > timezone.now()
        )

    @property
    def trust_rank(self) -> int:
        return TRUST_RANK.get(self.trust, 0)

    def has_trust(self, required: str) -> bool:
        return self.trust_rank >= TRUST_RANK.get(required, 0)

    def revoke(self) -> None:
        self.revoked_at = timezone.now()
        self.save(update_fields=["revoked_at", "updated_at"])


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
