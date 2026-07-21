"""
Импорт этого пакета регистрирует всех подписчиков. Вызывается из
CoreConfig.ready() — единственная точка, где определяется их набор.
"""

from . import analytics, audit, tracker  # noqa: F401

__all__ = ["analytics", "audit", "tracker"]
