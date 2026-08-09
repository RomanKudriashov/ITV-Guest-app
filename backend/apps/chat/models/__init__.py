"""Чат гостя и персонала: тред на гостя, сообщения внутри треда."""

from __future__ import annotations

from .message import ChatMessage
from .thread import ChatThread

__all__ = ["ChatMessage", "ChatThread"]
