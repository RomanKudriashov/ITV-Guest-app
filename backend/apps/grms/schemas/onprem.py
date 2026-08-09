"""
Схемы он-прем узла.

КОНТРАКТ КОНВЕРТА МЕНЯТЬ НЕЛЬЗЯ: на нём живёт коннектор в отеле, который мы не
можем обновить одновременно с сервером.
"""

from __future__ import annotations

from ninja import Schema


class HeartbeatIn(Schema):
    key: str
    version: str = ""
