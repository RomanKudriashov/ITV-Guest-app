from __future__ import annotations

from ninja import Schema


class RunIn(Schema):
    languages: list[str] | None = None
    groups: list[str] | None = None
