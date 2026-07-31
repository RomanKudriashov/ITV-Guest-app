"""
Сводка по платформе: KPI по ВСЕМ отелям, рост и здоровье системы.

Ключевое решение — как считать. Наивный путь «пройти по отелям в tenant_context
и сложить» даёт N запросов на каждую цифру и растёт линейно с флотом: на сотне
отелей сводка стала бы самой дорогой страницей продукта. Поэтому агрегаты
берутся ОДНИМ запросом через платформенное подключение (BYPASSRLS) — оно и
существует ровно для взгляда поверх тенантов.

Цифры берутся из тех же роллапов, что и аналитика отеля (`OrderDaily`), а не
считаются заново по заказам: иначе у платформы и у отеля разошлись бы ответы на
один и тот же вопрос, и выяснять, кто прав, пришлось бы в проде.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import GuestSession
from apps.analytics.models import OrderDaily
from apps.core.context import platform_scope
from apps.hotels import tariffs
from apps.hotels.models import Hotel
from apps.media.models import MediaAsset

# Насколько заранее предупреждать об истечении триала. Две недели — весь срок
# триала; за меньшее платформа не успевает поговорить с отелем.
TRIAL_WARNING_DAYS = 7
GROWTH_MONTHS = 10


def _month_key(moment: date) -> str:
    return f"{moment.year:04d}-{moment.month:02d}"


def _hotel_states(hotels: list[Hotel], today: date) -> dict[str, int]:
    """Разложение флота по состояниям. Триал — не статус, а тариф со сроком."""
    active = trial = disabled = 0
    for hotel in hotels:
        if not hotel.is_active:
            disabled += 1
        elif tariffs.get(hotel.tariff).is_trial:
            trial += 1
        else:
            active += 1
    return {"total": len(hotels), "active": active, "trial": trial, "disabled": disabled}


def _growth(hotels: list[Hotel], today: date) -> list[dict]:
    """Сколько отелей заведено по месяцам — ряд для спарклайна."""
    buckets: dict[str, int] = {}
    cursor = date(today.year, today.month, 1)
    for _ in range(GROWTH_MONTHS):
        buckets[_month_key(cursor)] = 0
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    for hotel in hotels:
        key = _month_key(hotel.created_at.date())
        if key in buckets:
            buckets[key] += 1
    return [{"month": key, "hotels": value} for key, value in sorted(buckets.items())]


def _orders_block(today: date) -> dict:
    """
    Заказы и оборот за день по всей платформе — одним запросом поверх тенантов.

    Оборот — gross (позиции + сбор + доставка + налог + чаевые), как и в
    аналитике отеля: платформа и отель обязаны называть «оборотом» одно и то же.
    """
    with platform_scope():
        agg = (
            OrderDaily.all_objects.using("platform")
            .filter(business_date=today)
            .aggregate(
                orders=Sum("orders_count"),
                revenue=Sum("revenue_minor"),
                service_fee=Sum("service_fee_minor"),
                delivery=Sum("delivery_minor"),
                tax=Sum("tax_minor"),
                tip=Sum("tip_minor"),
            )
        )
    values = {key: (value or 0) for key, value in agg.items()}
    return {
        "orders_today": values["orders"],
        "gross_today_minor": (
            values["revenue"] + values["service_fee"] + values["delivery"] + values["tax"] + values["tip"]
        ),
    }


def _live_sessions() -> int:
    """Гостей на витрине прямо сейчас: живая, не отозванная сессия."""
    now = timezone.now()
    with platform_scope():
        return (
            GuestSession.all_objects.using("platform")
            .filter(expires_at__gt=now, revoked_at__isnull=True)
            .count()
        )


def _health(hotels: list[Hotel], today: date) -> list[dict]:
    """
    Здоровье системы: список того, что требует внимания. Пустой список — это
    ответ «всё в порядке», а не отсутствие данных, поэтому «норма» тоже строка.
    """
    signals: list[dict] = []

    with platform_scope():
        media = MediaAsset.all_objects.using("platform").aggregate(
            failed=Count("id", filter=Q(status=MediaAsset.Status.FAILED)),
            stuck=Count(
                "id",
                filter=Q(
                    status__in=[MediaAsset.Status.PENDING, MediaAsset.Status.PROCESSING],
                    created_at__lt=timezone.now() - timedelta(minutes=30),
                ),
            ),
        )
    if media["failed"]:
        signals.append({"level": "bad", "code": "media_failed", "count": media["failed"]})
    if media["stuck"]:
        # Зависшая обработка выглядит для отеля как «фото не грузится», и без
        # этого сигнала платформа узнаёт о ней от него, а не от себя.
        signals.append({"level": "warn", "code": "media_stuck", "count": media["stuck"]})
    if not media["failed"] and not media["stuck"]:
        signals.append({"level": "ok", "code": "media_ok", "count": 0})

    expiring = [
        {"hotel": hotel.name, "subdomain": hotel.subdomain, "days": tariffs.trial_days_left(hotel, today)}
        for hotel in hotels
        if (tariffs.trial_days_left(hotel, today) or 99) <= TRIAL_WARNING_DAYS
    ]
    for entry in expiring:
        signals.append(
            {
                "level": "warn" if (entry["days"] or 0) >= 0 else "bad",
                "code": "trial_expiring" if (entry["days"] or 0) >= 0 else "trial_expired",
                "hotel": entry["hotel"],
                "subdomain": entry["subdomain"],
                "days": entry["days"],
            }
        )

    from apps.hotels.models import OnPremNode

    with platform_scope():
        offline = list(
            OnPremNode.all_objects.using("platform")
            .filter(is_revoked=False)
            .select_related("hotel")
        )
    for node in offline:
        if not node.is_online:
            signals.append(
                {
                    "level": "warn",
                    "code": "node_offline",
                    "hotel": node.hotel.name,
                    "subdomain": node.hotel.subdomain,
                    "purpose": node.purpose,
                    "seconds": node.seconds_since_seen,
                }
            )
    return signals


def build_overview() -> dict:
    """Всё, что показывает главный экран /admin."""
    hotels = list(Hotel.objects.all())
    today = timezone.localdate()
    return {
        "hotels": _hotel_states(hotels, today),
        **_orders_block(today),
        "live_sessions": _live_sessions(),
        "growth": _growth(hotels, today),
        "health": _health(hotels, today),
        "tariffs": [
            {
                "code": tariff.code,
                "title": tariff.title,
                "modules": list(tariff.modules),
                "limits": asdict(tariff.limits),
                "is_trial": tariff.is_trial,
                "hotels": sum(1 for hotel in hotels if tariffs.get(hotel.tariff).code == tariff.code),
            }
            for tariff in tariffs.TARIFFS.values()
        ],
    }
