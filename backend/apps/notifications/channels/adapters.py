"""Реализации каналов: лог, e-mail, Telegram."""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMessage

from apps.core.errors import ValidationError

from .base import ChannelError, RenderedMessage

logger = logging.getLogger("apps.notifications")


class LogAdapter:
    """
    Пишет в лог приложения и всегда успешен.

    Не заглушка ради галочки, а рабочий канал для разработки и CI: без него
    каждый, кто поднимает проект, был бы обязан завести бота и SMTP, чтобы
    просто увидеть, как работает эскалация.
    """

    type = "log"
    secret_fields: tuple[str, ...] = ()

    def validate_config(self, config: dict) -> None:
        return None

    def send(self, message: RenderedMessage, config: dict) -> str:
        logger.info("[notification] %s | %s", message.subject, message.body)
        return "logged"


class EmailAdapter:
    type = "email"
    secret_fields: tuple[str, ...] = ()

    def validate_config(self, config: dict) -> None:
        recipients = config.get("to") or []
        if isinstance(recipients, str):
            recipients = [recipients]
        if not recipients:
            raise ValidationError(
                "Укажите хотя бы одного получателя", field="config.to", code="channel_config_invalid"
            )
        for address in recipients:
            if "@" not in str(address):
                raise ValidationError(
                    f"Некорректный адрес: {address}",
                    field="config.to",
                    code="channel_config_invalid",
                )

    def send(self, message: RenderedMessage, config: dict) -> str:
        recipients = config.get("to") or []
        if isinstance(recipients, str):
            recipients = [recipients]

        email = EmailMessage(
            subject=message.subject or "Уведомление",
            body=message.body,
            from_email=config.get("from_email") or settings.DEFAULT_FROM_EMAIL,
            to=list(recipients),
        )
        try:
            sent = email.send(fail_silently=False)
        except Exception as exc:  # noqa: BLE001 — сеть/SMTP, повторить имеет смысл
            raise ChannelError(f"SMTP: {exc}") from exc
        if not sent:
            raise ChannelError("SMTP не принял письмо")
        return f"email:{','.join(recipients)}"


class TelegramAdapter:
    """
    Telegram: личный канал через бота платформы (`platform_bot`, токен из
    окружения) или общий чат со своим ботом отеля (`bot_token` в конфигурации).

    Запрос, разметка и разбор ошибок — в `messengers/telegram.py`: HTML с
    экранированием вместо Markdown, 429 с Retry-After, блокировка бота
    получателем, токен в тексте ошибки не появляется (п.31 бэклога).
    """

    type = "telegram"
    secret_fields: tuple[str, ...] = ("bot_token",)

    def validate_config(self, config: dict) -> None:
        if not str(config.get("bot_token") or "").strip():
            raise ValidationError(
                "Нужен токен бота", field="config.bot_token", code="channel_config_invalid"
            )
        if not str(config.get("chat_id") or "").strip():
            raise ValidationError(
                "Нужен chat_id", field="config.chat_id", code="channel_config_invalid"
            )

    def send(self, message: RenderedMessage, config: dict) -> str:
        from apps.notifications.messengers import MessengerError
        from apps.notifications.messengers.telegram import TelegramBot

        chat_id = str(config.get("chat_id") or "").strip()
        if config.get("platform_bot"):
            bot = TelegramBot()
            if not bot.configured():
                raise ChannelError("Бот не подключён: токен не задан", retryable=False)
            if not chat_id:
                raise ChannelError("Telegram отвязан — адреса нет", retryable=False)
            buttons = list(message.buttons or ())
        else:
            bot = TelegramBot(token=str(config.get("bot_token") or ""))
            # Кнопки — только у бота платформы: нажатия чужого бота нам не придут.
            buttons = []

        try:
            message_id = bot.send(chat_id, message.subject, message.body, buttons)
        except MessengerError as exc:
            raise ChannelError(
                exc.detail,
                retryable=exc.retryable,
                retry_after=exc.retry_after,
                blocked=exc.blocked,
            ) from None
        return f"telegram:{message_id}"


ADAPTERS: dict[str, object] = {
    adapter.type: adapter
    for adapter in (LogAdapter(), EmailAdapter(), TelegramAdapter())
}


def get_adapter(channel_type: str):
    adapter = ADAPTERS.get(channel_type)
    if adapter is None:
        raise ValidationError(f"Неизвестный тип канала: {channel_type}", field="type")
    return adapter
