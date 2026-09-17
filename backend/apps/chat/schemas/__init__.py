"""Схемы чата."""

from __future__ import annotations

from ninja import Schema


class MessageIn(Schema):
    body: str


class DeskTaskIn(Schema):
    """Задача отделу: кому и что сделать."""

    point: str
    text: str


class ChatSettingsIn(Schema):
    reply_wait_minutes: int | None = None
