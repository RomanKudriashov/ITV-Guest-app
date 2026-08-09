"""Схемы чата."""

from __future__ import annotations

from ninja import Schema


class MessageIn(Schema):
    body: str
