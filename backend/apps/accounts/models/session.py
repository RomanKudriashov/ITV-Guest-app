"""
Реестр сессий персонала — то, чем отзывается выданный refresh.

Без него «выйти» означало только «забыть токены в этом браузере»: подписанный
JWT живёт своей жизнью до истечения, и копия, снятая заранее, продолжала
работать неделю. Здесь у каждой пары токенов есть строка, и обмен по refresh
сверяется с ней на каждом обновлении.

Отель необязателен: у платформенного администратора его нет, и такие строки
видны только платформенной роли (RLS, NULLABLE_TENANT_TABLES) — ровно как у
`accounts_user`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.models import BaseModel


class StaffSession(BaseModel):
    class Scope(models.TextChoices):
        STAFF = "staff", "Сотрудник отеля"
        PLATFORM = "platform", "Платформа"

    hotel = models.ForeignKey(
        "hotels.Hotel",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="staff_sessions",
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="sessions"
    )
    scope = models.CharField(max_length=16, choices=Scope.choices)

    # Чем и откуда вошли — чтобы человек узнал свою сессию в списке и заметил
    # чужую. Больше ничего: список сессий не место для слежки за сотрудником.
    user_agent = models.CharField(max_length=200, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    last_seen_at = models.DateTimeField(default=timezone.now, db_index=True)
    # Совпадает со сроком refresh: дальше строка бесполезна и подлежит уборке.
    expires_at = models.DateTimeField(db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_staff_session"
        ordering = ["-last_seen_at"]
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self) -> str:
        return f"{self.user_id} · {self.scope}"

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()
