"""
Гостевая сессия и уровни доверия.

Доверие — не роль: оно ограничивает ДЕЙСТВИЯ, а не просмотр. Отсканировал QR
номера — можно заказывать; пришёл по ссылке без комнаты — смотреть можно всё,
а заказать нечего и некуда.
"""

from __future__ import annotations

from datetime import timedelta
from django.conf import settings
from django.utils import timezone
import hashlib
import secrets

from django.db import models

from apps.core.models import TenantModel


class TrustLevel(models.TextChoices):
    """Порядок важен — сравнение идёт по рангу, см. TRUST_RANK."""

    ANONYMOUS = "anonymous", "Аноним (открыл ссылку)"
    ROOM_SCANNED = "room_scanned", "Отсканировал QR в номере"
    PMS_VERIFIED = "pms_verified", "Подтверждён по брони в PMS"
    STAFF_VERIFIED = "staff_verified", "Подтверждён сотрудником"


# Порядок уровней числом: сравнение доверия должно быть сравнением, а не
# перебором строк по месту.
TRUST_RANK: dict[str, int] = {
    TrustLevel.ANONYMOUS: 0,
    TrustLevel.ROOM_SCANNED: 10,
    TrustLevel.PMS_VERIFIED: 20,
    TrustLevel.STAFF_VERIFIED: 30,
}


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

    # Устройство подтвердило PIN проживания (управление номером, G5).
    #
    # ОТДЕЛЬНОЕ ПОЛЕ, А НЕ УРОВЕНЬ ДОВЕРИЯ, и это принципиально. Напрашивалось
    # поднимать сессию до `pms_verified`, но этот уровень означает «сверено с
    # PMS». PMS-интеграции нет; заняв уровень подтверждением по PIN, мы бы
    # получили систему, где `pms_verified` больше не значит того, что написано,
    # — и в тот день, когда PMS появится, отличить настоящую сверку от ввода
    # четырёх цифр стало бы нечем. Лестница доверия остаётся нетронутой,
    # `pms_verified` — пустым слотом под настоящую интеграцию.
    room_verified_at = models.DateTimeField(null=True, blank=True)

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
