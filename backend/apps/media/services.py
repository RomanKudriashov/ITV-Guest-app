"""
Сервисный слой медиа. Вьюхи не трогают ни MinIO, ни Celery напрямую.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from django.db import transaction

from apps.core.context import require_hotel_id

from . import storage
from .models import CategoryPlaceholder, MediaAsset
from .tasks import process_media_asset


def upload_asset(
    *,
    content: bytes,
    filename: str,
    kind: str = MediaAsset.Kind.OTHER,
    content_type: str = "application/octet-stream",
    alt: dict | None = None,
) -> MediaAsset:
    """
    Кладёт оригинал и ставит задачу нарезки. Возвращает ассет в статусе
    PENDING — вызывающий не ждёт обработки.
    """
    hotel_id = require_hotel_id()
    safe_name = f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"
    key = storage.object_key(hotel_id, kind, safe_name)
    storage.put_bytes(key, content, content_type=content_type)

    asset = MediaAsset.objects.create(
        kind=kind,
        status=MediaAsset.Status.PENDING,
        object_key=key,
        original_filename=filename[:255],
        content_type=content_type,
        size_bytes=len(content),
        alt=alt or {},
    )
    # Строго после коммита: воркер живёт в другом процессе и, поставленный в
    # очередь раньше, успевает прочитать базу до того, как в ней появится
    # ассет. То же правило, что и для событийной шины.
    transaction.on_commit(
        lambda: process_media_asset.delay(str(asset.pk), str(hotel_id))
    )
    return asset


def image_url(asset: MediaAsset | None, *, variant: str = "card", fallback_code: str = "") -> str:
    """Единая точка получения картинки: ассет → заглушка по категории → пусто."""
    if asset is not None:
        url = asset.url(variant)
        if url:
            return url
    return CategoryPlaceholder.url_for(fallback_code or "default")
