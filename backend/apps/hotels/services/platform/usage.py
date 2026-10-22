"""
Журнал активности отеля.

Лимиты и использование против тарифа ушли вместе с тарифами (партия 62-E1,
решение Олега 22.10.2026).
"""

from __future__ import annotations

from apps.core.context import platform_scope
from apps.core.models import AuditLog
from apps.hotels.models import Hotel


def activity_for(hotel: Hotel, *, limit: int = 50) -> list[dict]:
    """
    Журнал отеля: что с ним делали платформа и его собственные админы.

    Читается платформенным подключением: записи о действиях ПЛАТФОРМЫ над
    отелем нужны здесь целиком, включая те, что писались вне тенантного
    контекста.
    """
    with platform_scope():
        rows = list(
            AuditLog.all_objects.using("platform")
            .filter(hotel_id=hotel.pk)
            .order_by("-created_at")[: max(1, min(limit, 200))]
        )
    return [
        {
            "id": str(row.pk),
            "at": row.created_at.isoformat(),
            "actor_type": row.actor_type,
            "actor_id": str(row.actor_id) if row.actor_id else None,
            "impersonated_by": str(row.impersonated_by) if row.impersonated_by else None,
            "action": row.action,
            "object_type": row.object_type,
            "payload": row.payload,
        }
        for row in rows
    ]
