"""
Health-эндпоинт: не «сервис жив», а «фундамент собран правильно».
Проверяет реальные зависимости, а не возвращает 200 безусловно.
"""

from __future__ import annotations

from django.conf import settings
from django.db import connections
from ninja import Router

from apps.events.bus import registered_subscribers

router = Router(tags=["platform"])


def _check_db(alias: str) -> dict:
    try:
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _check_redis() -> dict:
    try:
        import redis

        redis.Redis.from_url(settings.REDIS_URL).ping()
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _check_minio() -> dict:
    try:
        from apps.media.storage import get_client

        get_client().bucket_exists(settings.MINIO_BUCKET)
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@router.get("", auth=None, summary="Состояние сервиса и его зависимостей")
def health(request):
    checks = {
        "database": _check_db("default"),
        "database_platform": _check_db("platform"),
        "redis": _check_redis(),
        "minio": _check_minio(),
    }
    return {
        "status": "ok" if all(check["ok"] for check in checks.values()) else "degraded",
        "tenant": getattr(getattr(request, "hotel", None), "subdomain", None),
        "checks": checks,
        "event_subscribers": registered_subscribers(),
    }
