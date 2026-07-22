"""
Скоуп прав аналитики — теми же привязками, что и трекер.

* платформенный админ и админ отеля — весь отель (все точки);
* иначе сотрудник — только назначенные точки (`StaffAssignment`).

Скоуп применяется к КАЖДОМУ агрегатному запросу; заказ без точки виден только
админу отеля. Тенант-изоляция сверх этого — RLS: отель A не видит строк B.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Scope:
    all_points: bool
    point_ids: list[str] | None  # None когда all_points
    is_hotel_admin: bool
    is_platform: bool


def scope_for(user) -> Scope:
    if getattr(user, "is_platform_admin", False):
        return Scope(all_points=True, point_ids=None, is_hotel_admin=True, is_platform=True)
    if getattr(user, "is_hotel_admin", False):
        return Scope(all_points=True, point_ids=None, is_hotel_admin=True, is_platform=False)

    from apps.orders.tracker import assigned_points

    ids = [str(point.pk) for point in assigned_points(user)]
    return Scope(all_points=False, point_ids=ids, is_hotel_admin=False, is_platform=False)


def scope_payload(user) -> dict:
    """Что доступно пользователю — фронт не гадает, какие фильтры показывать."""
    from apps.orders.tracker import assigned_points

    scope = scope_for(user)
    if scope.all_points:
        from apps.hotels.models import ExecutionPoint

        points = list(ExecutionPoint.objects.filter(is_active=True).order_by("code"))
    else:
        points = assigned_points(user)

    return {
        "all_points": scope.all_points,
        "is_hotel_admin": scope.is_hotel_admin,
        "is_platform": scope.is_platform,
        "points": [
            {"id": str(p.pk), "code": p.code, "title": p.title_i18n or p.code, "kind": p.kind}
            for p in points
        ],
    }
