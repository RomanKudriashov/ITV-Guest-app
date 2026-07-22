"""
Celery-задача экспорта. Тонкая: контекст отеля + вызов сервиса, вся логика в
export.py (тесты зовут execute_export напрямую, без воркера).
"""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger("apps.analytics")


@shared_task(bind=True, max_retries=2, acks_late=True)
def run_export_task(self, export_id: str, hotel_id: str) -> dict:
    from .export import execute_export

    try:
        export = execute_export(export_id, hotel_id)
    except Exception as exc:  # noqa: BLE001 — БД могла моргнуть
        logger.exception("Экспорт %s упал", export_id)
        raise self.retry(exc=exc, countdown=15) from exc
    return {"export_id": export_id, "status": export.status if export else "missing"}
