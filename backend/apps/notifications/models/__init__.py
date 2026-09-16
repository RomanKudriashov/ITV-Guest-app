"""Уведомления персоналу: каналы, правила эскалации, журнал отправок."""

from __future__ import annotations

from .channel import NotificationChannel
from .escalation import EscalationRule, EscalationStep
from .event_log import EventDelivery, EventRecord
from .log import NotificationLog
from .vocabulary import ChannelType, NotificationStatus, TargetKind

__all__ = [
    "ChannelType",
    "EscalationRule",
    "EscalationStep",
    "EventDelivery",
    "EventRecord",
    "NotificationChannel",
    "NotificationLog",
    "NotificationStatus",
    "TargetKind",
]
