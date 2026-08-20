"""
Использование отеля против лимитов тарифа и журнал его активности.

Лимит здесь — не запрет, а ПРЕДУПРЕЖДЕНИЕ. Отель, который перерос тариф, не
должен переставать работать: гость в номере не виноват в том, что платформа и
отель не договорились о цене. Поэтому превышение видно платформе, а не гостю, и
решение о нём принимает человек.

Из того же соображения понижение тарифа ниже фактического использования не
блокируется намертво: оно требует явного подтверждения. Запрет заставил бы
сначала ломать отель (удалять сервисы), чтобы потом перевести его на тариф, —
порядок действий, обратный здравому смыслу.
"""

from __future__ import annotations

from dataclasses import asdict

from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.hotels.services import tariffs
from apps.hotels.models import Hotel, Room, Service


def current_usage(hotel: Hotel) -> dict[str, int]:
    """Сколько отель ФАКТИЧЕСКИ использует. Считается в контексте тенанта."""
    from apps.accounts.models import User

    with tenant_context(hotel):
        return {
            "services": Service.objects.count(),
            "rooms": Room.objects.count(),
            "staff": User.objects.filter(is_staff_member=True).count(),
        }


def _rows(usage: dict[str, int], limits) -> list[dict]:
    data = asdict(limits)
    rows = []
    for key in ("services", "rooms", "staff"):
        limit = data.get(key)
        used = usage.get(key, 0)
        rows.append(
            {
                "key": key,
                "used": used,
                "limit": limit,
                # None — без лимита: не «ноль», а «сколько угодно».
                "ratio": None if limit in (None, 0) else round(used / limit, 3),
                "over": limit is not None and used > limit,
            }
        )
    return rows


def usage_for(hotel: Hotel) -> dict:
    tariff = tariffs.get(hotel.tariff)
    usage = current_usage(hotel)
    return {
        "tariff": tariff.code,
        "tariff_title": tariff.title,
        "is_trial": tariff.is_trial,
        "trial_ends_at": str(hotel.trial_ends_at) if hotel.trial_ends_at else None,
        "trial_days_left": tariffs.trial_days_left(hotel),
        "tariff_started_on": str(hotel.tariff_started_on) if hotel.tariff_started_on else None,
        "rows": _rows(usage, tariff.limits),
    }


def downgrade_warnings(hotel: Hotel, next_tariff_code: str) -> list[dict]:
    """
    Что сломается, если перевести отель на другой тариф.

    Считаем ДО записи и по фактическому использованию, а не по прежнему тарифу:
    вопрос «влезет ли отель в новый тариф» не зависит от того, где он был.
    """
    usage = current_usage(hotel)
    limits = asdict(tariffs.get(next_tariff_code).limits)
    warnings = []
    for key, limit in limits.items():
        used = usage.get(key, 0)
        if limit is not None and used > limit:
            warnings.append({"key": key, "used": used, "limit": limit})

    # Модули, которые погаснут на новом тарифе. Список считается ТОЙ ЖЕ
    # формулой, которой потом идёт пересчёт (`resolve_enabled`), — иначе
    # предупреждение и действие разъедутся.
    #
    # Так было до R6: комментарий здесь обещал, что модуль «не выключается сам»,
    # потому что переопределение — законный способ оставить фичу вне тарифа. На
    # деле смена тарифа не трогала реестр ВООБЩЕ, и предупреждение оставалось
    # словами: перечисленные модули продолжали работать. Теперь они гаснут, а
    # решение оставить фичу вне тарифа принимается заново — тумблером, после.
    from apps.hotels.module_registry import modules_lost_on

    lost = modules_lost_on(hotel, next_tariff_code)
    if lost:
        warnings.append({"key": "modules", "modules": lost})
    return warnings


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
