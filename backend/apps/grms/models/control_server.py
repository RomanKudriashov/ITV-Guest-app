"""
СЕРВЕР УПРАВЛЕНИЯ ОТЕЛЯ (партия 63-3).

Куда коннектор отеля шлёт команды оборудованию: тип сервера, адрес, порт,
протокол, авторизация, таймаут. Задаётся в Control; коннектор принимает адрес
только в пределах разрешённого круга, заданного при установке на объекте
(`connector/itv_connector/remote.py`). Не задан — коннектор работает по своему
локальному файлу, как до 63-3.

Одна запись на отель: сервер управления у отеля один, коннектор — дорога к
нему. Путь «напрямую из облака» не делаем (решение Олега 23.10).
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ControlServer(TenantModel):
    class Kind(models.TextChoices):
        IRIDI = "iridi", "iRidi"
        # «Скоро»: в выборе есть, настроить нельзя (Bittel — TCP/MySQL,
        # коннектор пока говорит только HTTP).
        BITTEL = "bittel", "Bittel"
        OTHER = "other", "Другое"

    class Protocol(models.TextChoices):
        HTTP = "http", "HTTP"
        HTTPS = "https", "HTTPS"

    class Auth(models.TextChoices):
        NONE = "none", "Без входа"
        BASIC = "basic", "Логин и пароль"
        TOKEN = "token", "Токен"

    node = models.ForeignKey("hotels.OnPremNode", on_delete=models.SET_NULL, null=True, blank=True, related_name="control_servers")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.IRIDI)
    protocol = models.CharField(max_length=8, choices=Protocol.choices, default=Protocol.HTTP)
    host = models.CharField(max_length=255)
    port = models.PositiveIntegerField(default=1085)
    auth = models.CharField(max_length=8, choices=Auth.choices, default=Auth.NONE)
    login = models.CharField(max_length=128, blank=True)
    # Пароль или токен — ЗАШИФРОВАННЫЙ (`apps.grms.vault`). Открытым не хранится.
    secret_sealed = models.TextField(blank=True)
    timeout_ms = models.PositiveIntegerField(default=3000)
    is_enabled = models.BooleanField(default=True)
    # Номер правки: коннектор отвечает, какую принял, — так видно, дошла ли.
    revision = models.PositiveIntegerField(default=1)
    applied_revision = models.PositiveIntegerField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    apply_error = models.CharField(max_length=32, blank=True)
    apply_detail = models.CharField(max_length=255, blank=True)
    last_check_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True, blank=True)
    last_check_detail = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "grms_control_server"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel"], condition=models.Q(deleted_at__isnull=True), name="uniq_grms_control_server_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.host}:{self.port}"

    @property
    def base_url(self) -> str:
        return f"{self.protocol}://{self.host}:{self.port}"
