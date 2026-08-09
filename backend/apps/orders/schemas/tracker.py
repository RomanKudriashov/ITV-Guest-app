"""Схемы трекера. Объявлялись во вьюхе; имена не менялись."""

from __future__ import annotations

from ninja import Schema


class StatusIn(Schema):
    status: str
    comment: str = ""


class CancelIn(Schema):
    reason: str = ""


class AcceptIn(Schema):
    pass
