"""Схемы гостевого управления номером."""

from __future__ import annotations

from ninja import Schema


class VerifyIn(Schema):
    pin: str


class CommandIn(Schema):
    controlId: str
    # Нужен только составным элементам: у кондиционера четыре ручки под одним
    # controlId. Для простых опускается.
    capability: str = ""
    value: int | None = None
