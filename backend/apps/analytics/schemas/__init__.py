"""Схемы аналитики — CMS. Объявлялись во вьюхе, имя не менялось."""

from __future__ import annotations

from ninja import Schema


class ExportIn(Schema):
    kind: str = "breakdown"
    format: str = "csv"
    params: dict = {}
