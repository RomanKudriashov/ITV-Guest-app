"""
Скоуп прав аналитики.

* платформенный админ и админ отеля — весь отель (все точки);
* управляющий сервисом — только те заведения, которыми он УПРАВЛЯЕТ;
* линейный персонал — аналитики не видит вовсе (в CMS его не пускают).

Раньше скоуп строился по всем привязкам сотрудника, а не по управляемым: повар
видел выручку своей кухни. С R3 аналитика — инструмент управляющего (карта
продукта, Часть 3), и привязка «я тут работаю» права на цифры не даёт. Для
управляющего это ещё и сужение: работая барменом в чужом баре, он видит
аналитику своего ресторана, но не того бара.

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

    from apps.accounts.services.roles import access_for

    ids = sorted(access_for(user).managed_point_ids)
    return Scope(all_points=False, point_ids=ids, is_hotel_admin=False, is_platform=False)


def scope_payload(user) -> dict:
    """Что доступно пользователю — фронт не гадает, какие фильтры показывать."""
    from apps.hotels.models import ExecutionPoint

    scope = scope_for(user)
    points = ExecutionPoint.objects.filter(is_active=True).order_by("code")
    if not scope.all_points:
        points = points.filter(pk__in=scope.point_ids or [])
    points = list(points)

    return {
        "all_points": scope.all_points,
        "is_hotel_admin": scope.is_hotel_admin,
        "is_platform": scope.is_platform,
        "points": [
            {"id": str(p.pk), "code": p.code, "title": p.title_i18n or p.code, "kind": p.kind}
            for p in points
        ],
    }
