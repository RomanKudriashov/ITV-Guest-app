"""Как баннер выглядит снаружи: гостю — показ, оператору — статистика."""

from __future__ import annotations

from django.db.models import Count, Q, Sum

from apps.core.fields import translate
from apps.media.services.assets import image_url

from apps.promo.models import Banner, BannerView


def _images(banner: Banner) -> list[str]:
    return [
        image_url(link.asset, variant="full")
        for link in banner.images.all()
        if link.asset_id
    ]


def guest_payload(banner: Banner, *, language: str) -> dict:
    """
    Тело для витрины. Действие отдаётся РАЗОБРАННЫМ: витрина не должна
    догадываться по непустому полю, куда вести гостя.
    """
    action = {"kind": banner.action}
    if banner.action == Banner.Action.LINK:
        action["url"] = banner.action_url
    elif banner.action == Banner.Action.VENUE and banner.action_service_id:
        action["venue_code"] = banner.action_service.code
    elif banner.action == Banner.Action.PAGE:
        action["page"] = {
            "title": translate(banner.page_title, language),
            "body": translate(banner.page_body, language),
        }
    return {
        "id": str(banner.pk),
        "title": translate(banner.title, language),
        "subtitle": translate(banner.subtitle, language),
        "size": banner.size,
        "placement": banner.placement,
        "images": _images(banner),
        "action": action,
    }


def stats_for(banner_ids) -> dict:
    """
    Четыре числа на баннер. CTR — переходы к показам, а не клики к показам:
    показ у нас на сессию, и делить на него общее число нажатий значило бы
    делить разные единицы. Гость, нажавший трижды, — один заинтересовавшийся.
    """
    rows = (
        BannerView.objects.filter(banner_id__in=list(banner_ids))
        .values("banner_id")
        # Алиасы НЕ повторяют имена полей: назвав агрегат `clicks`, мы бы
        # затенили колонку, и Django подставил бы `SUM(...)` внутрь `FILTER` —
        # Postgres такой запрос не выполняет вовсе.
        .annotate(
            impressions=Count("id"),
            clicks_total=Sum("clicks"),
            reached=Count("id", filter=Q(clicks__gt=0)),
            closed=Count("id", filter=Q(dismissed_at__isnull=False)),
        )
    )
    out = {}
    for row in rows:
        impressions = row["impressions"] or 0
        reached = row["reached"] or 0
        out[str(row["banner_id"])] = {
            "impressions": impressions,
            "clicks": row["clicks_total"] or 0,
            "reached": reached,
            "closed": row["closed"] or 0,
            "ctr": round(reached / impressions, 4) if impressions else 0.0,
        }
    return out


def cms_payload(banner: Banner, *, stats: dict | None = None) -> dict:
    return {
        "id": str(banner.pk),
        "name": banner.name,
        "title": banner.title or {},
        "subtitle": banner.subtitle or {},
        "size": banner.size,
        "placement": banner.placement,
        "action": banner.action,
        "action_url": banner.action_url,
        "action_service_id": str(banner.action_service_id) if banner.action_service_id else None,
        "page_title": banner.page_title or {},
        "page_body": banner.page_body or {},
        "is_active": banner.is_active,
        "starts_on": banner.starts_on.isoformat() if banner.starts_on else None,
        "ends_on": banner.ends_on.isoformat() if banner.ends_on else None,
        "time_from": banner.time_from.strftime("%H:%M") if banner.time_from else None,
        "time_to": banner.time_to.strftime("%H:%M") if banner.time_to else None,
        "first_visit_only": banner.first_visit_only,
        "languages": banner.languages or [],
        "room_category_ids": [str(pk) for pk in banner.room_categories.values_list("pk", flat=True)],
        "priority": banner.priority,
        "images": [
            {"id": str(link.pk), "asset_id": str(link.asset_id), "url": image_url(link.asset, variant="full")}
            for link in banner.images.all()
        ],
        "stats": (stats or {}).get(
            str(banner.pk),
            {"impressions": 0, "clicks": 0, "reached": 0, "closed": 0, "ctr": 0.0},
        ),
    }
