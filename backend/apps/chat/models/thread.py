"""
Чат гость ↔ персонал.

Тред живёт при СЕССИИ гостя, а не при заявке: гость пишет «когда завтрак?» вне
привязки к заказу, и переписка должна пережить оформление и закрытие заявок.
И не при номере: тред номера доставался следующему гостю вместе с перепиской
предыдущего (волна 8). Номер в треде — только чтобы персонал видел, откуда пишут.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ChatThread(TenantModel):
    class AuthorType(models.TextChoices):
        GUEST = "guest", "Гость"
        STAFF = "staff", "Персонал"

    room = models.ForeignKey(
        "hotels.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="chat_threads"
    )
    guest_session = models.ForeignKey(
        "accounts.GuestSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_threads",
    )
    # Кому маршрутизируется по умолчанию (ресепшн/консьерж). null — общий тред отеля.
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_threads",
    )
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # По ним живёт рабочее место ресепшена: список сортируется по последнему
    # сообщению ГОСТЯ, а «ждёт ответа» — это сообщение гостя позже последнего
    # ответа персонала. Полями, а не выводом из сообщений: список листается
    # курсором, и сортировать по подзапросу на каждой странице незачем.
    last_guest_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_staff_message_at = models.DateTimeField(null=True, blank=True)

    # КТО ОТВЕЧАЕТ. Не блокировка: другой может вмешаться, но видит, что
    # занято («отвечает Дарья»). Держатель действителен, пока он был активен
    # в диалоге недавно и его вход в систему жив — см. `chat.services.holding`.
    holder = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    holder_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "chat_thread"
        ordering = ["-last_message_at", "-created_at"]
        constraints = [
            # Один тред на сессию гостя. Без этого первое открытие чата и
            # подключение сокета создавали по треду каждое — и гость не
            # получал ответ вживую: слушал один тред, писали в другой.
            models.UniqueConstraint(
                fields=["guest_session"],
                condition=models.Q(guest_session__isnull=False),
                name="uniq_chat_thread_per_guest_session",
            )
        ]

    def __str__(self) -> str:
        return f"thread:{self.room.number if self.room_id else self.pk}"
