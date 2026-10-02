"""
Реестр мессенджеров бота платформы.

Сейчас — один Telegram. Max встанет второй строкой, реализовав `Messenger`
(`base.py`); служба опроса, привязка и кнопки работают через интерфейс и о
конкретном мессенджере не знают.
"""

from __future__ import annotations

from .base import Button, Incoming, Messenger, MessengerError

__all__ = ["Button", "Incoming", "Messenger", "MessengerError", "get", "CODES"]

CODES = ("telegram",)


def get(code: str = "telegram") -> Messenger:
    if code == "telegram":
        from .telegram import TelegramBot

        return TelegramBot()
    raise LookupError(f"Мессенджер «{code}» не подключён")
