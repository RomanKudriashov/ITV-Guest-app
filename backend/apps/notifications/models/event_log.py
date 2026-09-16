"""
ЖУРНАЛ СОБЫТИЙ — ОТДЕЛЬНО ОТ ЖУРНАЛА ЭСКАЛАЦИИ.

Журнал эскалации (`NotificationLog`) — журнал ДОСТАВОК ПО ЗАКАЗУ: заказ в нём
обязателен, и это правильно. Разрешить в нём пустой заказ значило бы
превратить его в журнал всего подряд, где половина строк без половины полей.
Поэтому события без заказа — оформление, сообщение гостя, низкая оценка —
пишутся сюда.

ДВЕ ТАБЛИЦЫ, А НЕ ОДНА С РОДИТЕЛЕМ. Факт события и его доставки — разные
вещи с разными полями: у факта есть данные события и итог, у доставки —
канал, язык, текст и статус. Сложенные в одну таблицу, они снова дали бы
строки без половины полей — ровно то, от чего уходили.

ЖУРНАЛ ПЕРВИЧЕН. Факт пишется ДО попытки отправки и остаётся, даже если
отправлять было некому или некуда: утром по нему восстанавливают, что ночью
произошло, и «никто не узнал» тоже должно быть видно.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel

from .channel import NotificationChannel
from .vocabulary import NotificationStatus


class EventRecord(TenantModel):
    """Факт события: что случилось, где, с какими данными и чем кончилась рассылка."""

    class Outcome(models.TextChoices):
        PENDING = "pending", "Рассылается"
        SENT = "sent", "Разослано"
        PARTIAL = "partial", "Разослано не всем"
        FAILED = "failed", "Не доставлено никому"
        NO_RECIPIENTS = "no_recipients", "Некому отправить"

    # Код из справочника `apps/notifications/events.py`.
    code = models.CharField(max_length=64, db_index=True)
    # Отдел события — по нему журнал режется для управляющего. Пусто — событие
    # уровня отеля (оформление): его видит только администратор отеля.
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # Данные события — те, что подставляются в текст. Храним, чтобы текст
    # можно было собрать заново на другом языке и разобрать, что пришло.
    payload = models.JSONField(default=dict, blank=True)
    outcome = models.CharField(
        max_length=16, choices=Outcome.choices, default=Outcome.PENDING
    )
    # Повтор события шины не должен давать второй записи и второго сообщения.
    dedupe_key = models.CharField(max_length=255)

    class Meta:
        db_table = "notifications_event"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "dedupe_key"], name="uniq_notification_event_per_hotel"
            )
        ]
        indexes = [models.Index(fields=["hotel", "code", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.code} [{self.outcome}]"


class EventDelivery(TenantModel):
    """Одна доставка события в один канал."""

    record = models.ForeignKey(EventRecord, on_delete=models.CASCADE, related_name="deliveries")
    channel = models.ForeignKey(
        NotificationChannel, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Кому — для личного канала. Общий канал отдела человека не имеет.
    recipient = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Снимки канала: канал могут удалить или переименовать, а журнал обязан
    # помнить, куда ушло.
    channel_type = models.CharField(max_length=32, blank=True)
    channel_title = models.CharField(max_length=128, blank=True)
    # На каком языке собран текст — ответ на вопрос «почему пришло по-английски».
    language = models.CharField(max_length=8, blank=True)
    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)

    status = models.CharField(
        max_length=16, choices=NotificationStatus.choices, default=NotificationStatus.SCHEDULED
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        db_table = "notifications_event_delivery"
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "record", "channel"],
                condition=models.Q(channel__isnull=False),
                name="uniq_event_delivery_per_channel",
            )
        ]

    def __str__(self) -> str:
        return f"{self.record_id} → {self.channel_title} [{self.status}]"
