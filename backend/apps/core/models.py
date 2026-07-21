"""
Базовые классы моделей. От них наследуется ВСЁ.

    BaseModel    — UUID pk, аудит-поля, soft-delete, переводимые поля.
    TenantModel  — то же + hotel_id и автоматический скоуп по тенанту.

Почему created_by — UUIDField, а не ForeignKey: базовый класс живёт в core,
а модель пользователя в accounts, которая сама ссылается на hotels. FK сделал
бы цикл зависимостей между приложениями на уровне миграций. Ссылка мягкая и
намеренная; жёсткая трассировка действий — в AuditLog.
"""

from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone

from .context import current_actor, current_hotel_id, require_hotel_id
from .fields import TranslatableMixin
from .managers import AllObjectsManager, BaseManager, TenantManager


def _actor_id() -> uuid.UUID | None:
    actor = current_actor()
    pk = getattr(actor, "pk", None)
    return pk if isinstance(pk, uuid.UUID) else None


class BaseModel(TranslatableMixin, models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.UUIDField(null=True, blank=True, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = BaseManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def save(self, *args, **kwargs):
        if self._state.adding and self.created_by is None:
            self.created_by = _actor_id()
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False, *, hard: bool = False):
        """По умолчанию мягко. Жёсткое удаление — только осознанно, hard=True."""
        if hard:
            return super().delete(using=using, keep_parents=keep_parents)
        self.deleted_at = timezone.now()
        self.save(using=using, update_fields=["deleted_at", "updated_at"])
        return (0, {})

    def restore(self, using=None):
        self.deleted_at = None
        self.save(using=using, update_fields=["deleted_at", "updated_at"])


class TenantModel(BaseModel):
    """
    Тенант-таблица: hotel_id + автоскоуп + RLS-политика в Postgres.

    hotel проставляется из контекста автоматически — прикладной код его не
    передаёт (но может, если работает на платформенном уровне).
    """

    hotel = models.ForeignKey(
        "hotels.Hotel",
        on_delete=models.CASCADE,
        related_name="%(class)ss",
        db_index=True,
    )

    objects = TenantManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self._state.adding and self.hotel_id is None:
            self.hotel_id = require_hotel_id()
        return super().save(*args, **kwargs)


class IdempotencyKey(TenantModel):
    """
    Ключ идемпотентности для небезопасных операций (в первую очередь — создание
    заказа). Хранит и слепок запроса, и готовый ответ: повтор с тем же ключом
    отдаёт тот же результат, а тот же ключ с другим телом — конфликт.
    """

    scope = models.CharField(max_length=64, db_index=True)
    key = models.CharField(max_length=255)
    request_fingerprint = models.CharField(max_length=64)
    response = models.JSONField(default=dict, blank=True)
    object_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "core_idempotency_key"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "scope", "key"], name="uniq_idempotency_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return f"{self.scope}:{self.key}"


class AuditLog(BaseModel):
    """
    Журнал действий. Пишется подписчиком событийной шины и вручную для
    чувствительных операций (impersonation, смена статуса заказа).

    hotel nullable: платформенные действия отелю не принадлежат. Поэтому это
    BaseModel, а не TenantModel, — и RLS-политика на таблице своя, допускающая
    строки без отеля.
    """

    class ActorType(models.TextChoices):
        STAFF = "staff", "Сотрудник"
        GUEST = "guest", "Гость"
        PLATFORM = "platform", "Платформа"
        SYSTEM = "system", "Система"

    hotel = models.ForeignKey(
        "hotels.Hotel",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor_type = models.CharField(
        max_length=16, choices=ActorType.choices, default=ActorType.SYSTEM
    )
    actor_id = models.UUIDField(null=True, blank=True)
    # Кто «на самом деле» действовал, если это вход поддержки под гостем/сотрудником.
    impersonated_by = models.UUIDField(null=True, blank=True)
    action = models.CharField(max_length=128, db_index=True)
    object_type = models.CharField(max_length=64, blank=True)
    object_id = models.UUIDField(null=True, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    objects = BaseManager()
    all_objects = AllObjectsManager()

    class Meta:
        db_table = "core_audit_log"
        indexes = [models.Index(fields=["hotel", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.action} by {self.actor_type}:{self.actor_id}"

    @classmethod
    def record(
        cls,
        action: str,
        *,
        actor_type: str = ActorType.SYSTEM,
        actor_id=None,
        object_type: str = "",
        object_id=None,
        payload: dict | None = None,
        hotel_id=None,
        impersonated_by=None,
        ip_address: str | None = None,
    ) -> "AuditLog":
        return cls.objects.create(
            hotel_id=hotel_id or current_hotel_id(),
            actor_type=actor_type,
            actor_id=actor_id if actor_id is not None else _actor_id(),
            impersonated_by=impersonated_by,
            action=action,
            object_type=object_type,
            object_id=object_id,
            payload=payload or {},
            ip_address=ip_address,
        )
