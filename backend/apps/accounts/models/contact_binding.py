"""
ОДНОРАЗОВЫЙ КОД ПРИВЯЗКИ МЕССЕНДЖЕРА.

Сотрудник жмёт «подключить Telegram», получает ссылку `t.me/<бот>?start=<код>`,
пишет боту — бот обменивает код на привязку. По образцу входа поддержки: в
базе только хэш, срок короткий, код гасится атомарно при обмене.

СВОЯ ТАБЛИЦА, А НЕ ПОЛЯ МОДЕЛИ. У входа поддержки код — свойство гранта: он
живёт и умирает вместе с ним, и поля на гранте — верное место. У привязки
родительской сущности нет: поля пришлось бы вешать на пользователя, по три на
каждый мессенджер, и строку учётки — ту, что проверяется на каждом запросе, —
переписывать выдачей кода. Здесь же у кода своя жизнь (выдан, истёк, обменян,
отозван новым), и она остаётся следом: кто, когда и какой аккаунт привязал.

И НЕ ОБЩАЯ ТАБЛИЦА ВСЕХ ОДНОРАЗОВЫХ КОДОВ. Потребителей два, и ищут они по-
разному: код поддержки обменивается на поддомене отеля, код привязки — ботом
платформы, у которого отеля нет. Общая таблица с полем «назначение» смешала бы
две области поиска, а переезд работающего механизма входа поддержки ради
симметрии — риск без выгоды.

Таблица тенантная (RLS): обмен идёт платформенным подключением, потому что бот
один на все отели и заранее не знает, чей код ему прислали.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.core.models import TenantModel

from .user import User


class ContactBindingCode(TenantModel):
    class Messenger(models.TextChoices):
        TELEGRAM = "telegram", "Telegram"
        MAX = "max", "Max"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="binding_codes")
    messenger = models.CharField(max_length=16, choices=Messenger.choices)
    # SHA-256 кода. Сам код показывается один раз и нигде не хранится.
    code_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    # Обменян ботом — и чем: ID аккаунта мессенджера, который привязали.
    used_at = models.DateTimeField(null=True, blank=True)
    external_id = models.CharField(max_length=64, blank=True)
    # Отозван новым кодом того же человека: действует только последний.
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_contact_binding_code"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "messenger", "used_at"])]

    def __str__(self) -> str:
        return f"{self.user_id} · {self.messenger}"

    @property
    def is_usable(self) -> bool:
        return (
            self.used_at is None
            and self.revoked_at is None
            and self.expires_at > timezone.now()
        )
