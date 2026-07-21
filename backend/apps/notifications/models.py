"""
Уведомления и эскалация.

Заявка бесполезна, если её никто не увидел. Отдел получает сообщение в свой
канал; если за отведённое время заявку не взяли — она поднимается выше по
ступеням. Взяли — эскалация гаснет.

Контракт и гарантии движка — docs/notifications-api-contract.md.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ChannelType(models.TextChoices):
    TELEGRAM = "telegram", "Telegram"
    EMAIL = "email", "E-mail"
    # Пишет в лог приложения и всегда успешен. Без него разработка и CI
    # требовали бы настоящих кредов у каждого, кто запускает проект.
    LOG = "log", "Лог (разработка)"


class TargetKind(models.TextChoices):
    POINT = "point", "Все каналы отдела"
    LEAD = "lead", "Старшие смены"
    MANAGER = "manager", "Руководители"
    CHANNEL = "channel", "Конкретный канал"


class NotificationStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Запланировано"
    SENT = "sent", "Отправлено"
    FAILED = "failed", "Ошибка канала"
    SKIPPED = "skipped", "Пропущено"
    CANCELLED = "cancelled", "Погашено (заказ приняли)"


class NotificationChannel(TenantModel):
    """
    Куда слать. Канал принадлежит отделу (общий чат кухни) либо сотруднику
    (личный Telegram старшего) — привязка решает, кого достанет ступень.
    """

    type = models.CharField(max_length=32, choices=ChannelType.choices, default=ChannelType.LOG)
    title = models.CharField(max_length=128)
    is_active = models.BooleanField(default=True)

    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notification_channels",
    )
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notification_channels",
    )

    # Секреты (bot_token) наружу не отдаются: в API уходит маскированная копия.
    config = models.JSONField(default=dict, blank=True)
    # {lang: {"subject": "...", "body": "..."}}
    templates = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "notifications_channel"
        ordering = ["title"]

    def __str__(self) -> str:
        return f"{self.title} ({self.type})"


class EscalationRule(TenantModel):
    """
    Правило подъёма для одной точки исполнения. execution_point=NULL — правило
    по умолчанию для отеля, применяется там, где своего нет.
    """

    name = models.CharField(max_length=128)
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="escalation_rules",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "notifications_escalation_rule"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class EscalationStep(TenantModel):
    """
    Одна ступень: «через N минут → кому».

    delay_minutes считается ОТ СОЗДАНИЯ ЗАКАЗА, а не от предыдущей ступени:
    «через 15 минут» тогда означает ровно то, что написано, и перенастройка
    одной ступени не сдвигает остальные.
    """

    rule = models.ForeignKey(EscalationRule, on_delete=models.CASCADE, related_name="steps")
    sort_order = models.PositiveSmallIntegerField(default=0)
    delay_minutes = models.PositiveIntegerField(default=0)
    target_kind = models.CharField(
        max_length=32, choices=TargetKind.choices, default=TargetKind.POINT
    )
    channel = models.ForeignKey(
        NotificationChannel,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="steps",
    )
    title = models.CharField(max_length=128, blank=True)

    class Meta:
        db_table = "notifications_escalation_step"
        ordering = ["sort_order", "delay_minutes"]

    def __str__(self) -> str:
        return f"+{self.delay_minutes}м → {self.target_kind}"


class NotificationLog(TenantModel):
    """
    Журнал и одновременно состояние движка.

    Родительская запись (channel=NULL) — «ступень сработала»; дочерние — по
    одной на канал, «сообщение ушло». Так видно и то, что ступень отработала,
    и куда именно она разошлась.

    dedupe_key с уникальным индексом — то, чем обеспечена идемпотентность:
    повтор Celery-задачи не приводит ко второму сообщению.
    """

    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="notifications"
    )
    rule = models.ForeignKey(
        EscalationRule, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    step = models.ForeignKey(
        EscalationStep, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    channel = models.ForeignKey(
        NotificationChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="deliveries"
    )

    step_index = models.PositiveSmallIntegerField(default=0)
    target_kind = models.CharField(max_length=32, blank=True)
    status = models.CharField(
        max_length=16, choices=NotificationStatus.choices, default=NotificationStatus.SCHEDULED
    )

    scheduled_for = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True)

    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)

    dedupe_key = models.CharField(max_length=255)
    celery_task_id = models.CharField(max_length=128, blank=True)
    # Было ли заказ уже принят в момент срабатывания ступени — для разбора
    # «почему не эскалировали».
    accepted_at_send = models.BooleanField(default=False)

    class Meta:
        db_table = "notifications_log"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "dedupe_key"], name="uniq_notification_dedupe_per_hotel"
            )
        ]
        indexes = [
            models.Index(fields=["hotel", "order", "-created_at"]),
            models.Index(fields=["hotel", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.dedupe_key} [{self.status}]"
