"""
Медиапайплайн. Всё тяжёлое и всё, что ходит наружу, — в Celery с ретраями.
"""

from __future__ import annotations

import io
import logging
import uuid

from celery import shared_task
from django.conf import settings
from PIL import Image, ImageOps

from apps.core.context import tenant_context

from . import storage
from .models import MediaAsset

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=5,
    acks_late=True,
)
def process_media_asset(self, asset_id: str, hotel_id: str) -> dict:
    """
    Нарезает варианты из оригинала.

    hotel_id передаётся явным аргументом: у воркера нет HTTP-запроса, а значит
    нет и контекста тенанта — без него RLS не отдаст ни строки.
    """
    with tenant_context(hotel_id):
        asset = MediaAsset.objects.filter(pk=asset_id).first()
        if asset is None:
            logger.warning("Ассет %s не найден (удалён?)", asset_id)
            return {"status": "missing"}

        asset.status = MediaAsset.Status.PROCESSING
        asset.save(update_fields=["status", "updated_at"])

        try:
            raw = storage.get_bytes(asset.object_key)
            variants = _render_variants(raw, asset)
        except Exception as exc:  # noqa: BLE001 — ретраит Celery, состояние фиксируем
            asset.status = MediaAsset.Status.FAILED
            asset.error = str(exc)[:2000]
            asset.save(update_fields=["status", "error", "updated_at"])
            raise

        asset.variants = variants
        asset.status = MediaAsset.Status.READY
        asset.error = ""
        # width/height проставляет _render_variants — их обязательно перечислить
        # в update_fields, иначе размеры оригинала молча не сохранятся.
        asset.save(
            update_fields=["variants", "status", "error", "width", "height", "updated_at"]
        )
        return {"status": "ready", "variants": list(variants)}


def _render_variants(raw: bytes, asset: MediaAsset) -> dict[str, str]:
    with Image.open(io.BytesIO(raw)) as image:
        # EXIF-поворот: фотографии с телефона иначе лягут боком.
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        asset.width, asset.height = image.size

        variants: dict[str, str] = {}
        for name, width in settings.MEDIA_VARIANTS.items():
            variant = image.copy()
            variant.thumbnail((width, width * 4), Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            variant.save(buffer, format="WEBP", quality=82, method=4)

            key = storage.object_key(
                asset.hotel_id, asset.kind, f"{uuid.uuid4().hex}.webp", variant=name
            )
            storage.put_bytes(key, buffer.getvalue(), content_type="image/webp")
            variants[name] = key

    return variants


@shared_task(autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def purge_media_asset(object_keys: list[str]) -> int:
    for key in object_keys:
        storage.delete_object(key)
    return len(object_keys)
