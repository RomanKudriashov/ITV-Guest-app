"""
Импорт этого пакета регистрирует всех подписчиков. Вызывается из
CoreConfig.ready() — единственная точка, где определяется их набор.
"""

from . import analytics, audit, escalation, tracker  # noqa: F401

__all__ = ["analytics", "audit", "escalation", "tracker"]
