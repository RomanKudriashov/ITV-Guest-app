"""Прогон перевода фоном: каталог отеля — это тысячи значений."""

from __future__ import annotations

from celery import shared_task

from apps.core.context import tenant_context


@shared_task(acks_late=True, max_retries=0)
def run_translation(run_id: str, hotel_id: str) -> dict:
    from apps.translate.models import TranslationRun
    from apps.translate.services.runner import execute, serialize_run

    with tenant_context(hotel_id):
        run = TranslationRun.objects.filter(pk=run_id).first()
        if run is None:
            return {"outcome": "gone"}
        return serialize_run(execute(run))
