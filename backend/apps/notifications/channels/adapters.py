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
        import requests

        token = str(config.get("bot_token") or "").strip()
        chat_id = str(config.get("chat_id") or "").strip()
        text = f"*{message.subject}*\n{message.body}" if message.subject else message.body

        url = f"{settings.TELEGRAM_API_URL.rstrip('/')}/bot{token}/sendMessage"
        try:
            response = requests.post(
                url,
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
                timeout=10,
            )
        except Exception as exc:  # noqa: BLE001 — сеть, повторить имеет смысл
            raise ChannelError(f"Telegram недоступен: {exc}") from exc

        if response.status_code == 200:
            return f"telegram:{response.json().get('result', {}).get('message_id', '')}"

        # 4xx кроме 429 — это наша ошибка настройки, повторять нечего.
        retryable = response.status_code >= 500 or response.status_code == 429
        raise ChannelError(
            f"Telegram ответил {response.status_code}: {response.text[:200]}",
            retryable=retryable,
        )


ADAPTERS: dict[str, object] = {
    adapter.type: adapter
    for adapter in (LogAdapter(), EmailAdapter(), TelegramAdapter())
}


def get_adapter(channel_type: str):
    adapter = ADAPTERS.get(channel_type)
    if adapter is None:
        raise ValidationError(f"Неизвестный тип канала: {channel_type}", field="type")
    return adapter
