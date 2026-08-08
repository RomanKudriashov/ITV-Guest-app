"""
Он-прем узел отеля.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class OnPremNode(TenantModel):
    """
    Он-прем узел отеля (Local Connector).

    Нужен, как только отелю включили GRMS или PMS: этими системами управляют из
    локальной сети объекта, и облако не может дотянуться до них напрямую. Узел —
    коробка на сервере отеля, которая ходит наружу сама и отмечается здесь.

    Платформа держит про узел ровно то, что нужно, чтобы понять «жив ли он и
    можно ли ему верить»: когда откликался и не отозван ли ключ. Ни адресов
    внутренней сети, ни учёток оборудования тут нет — они остаются на объекте.

    Хранится ХЭШ ключа, а не ключ: утечка этой таблицы не должна давать доступ
    к чужому оборудованию. Сам ключ показывается один раз при выдаче.
    """

    class Purpose(models.TextChoices):
        GRMS = "grms", "Управление номером"
        PMS = "pms", "PMS"
        BOTH = "both", "GRMS + PMS"

    name = models.CharField(max_length=128)
    purpose = models.CharField(max_length=16, choices=Purpose.choices, default=Purpose.GRMS)
    key_hash = models.CharField(max_length=64, blank=True)
    key_issued_at = models.DateTimeField(null=True, blank=True)
    is_revoked = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    version = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = "hotels_onprem_node"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "name"], name="uniq_node_per_hotel"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.purpose})"

    # Порог «жив»: узел отмечается раз в минуту, три пропуска подряд — уже не
    # сетевая икота, а повод показать это платформе.
    OFFLINE_AFTER_SECONDS = 180

    @property
    def seconds_since_seen(self) -> int | None:
        if not self.last_seen_at:
            return None
        from django.utils import timezone as dj_timezone

        return int((dj_timezone.now() - self.last_seen_at).total_seconds())

    @property
    def is_online(self) -> bool:
        seconds = self.seconds_since_seen
        return seconds is not None and seconds <= self.OFFLINE_AFTER_SECONDS

    @property
    def is_registered(self) -> bool:
        """Зарегистрирован — значит ключ выдан и не отозван."""
        return bool(self.key_hash) and not self.is_revoked
