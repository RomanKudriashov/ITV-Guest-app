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

from apps.media.services import storage
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
            update_fields=[
                "variants",
                "status",
                "error",
                "width",
                "height",
                "luminance",
                "updated_at",
            ]
        )
        return {"status": "ready", "variants": list(variants)}


def _mean_luminance(image) -> float:
    """
    Средняя относительная яркость кадра по WCAG 2.1, 0..1.

    Считается по уменьшенной копии: разница со средним по оригиналу — третий
    знак, а времени в сотни раз меньше. Формула та же, что у контраста, — иначе
    витрина подбирала бы затемнение по одной шкале, а проверяла по другой.
    """
    small = image.copy()
    small.thumbnail((64, 64), Image.Resampling.BILINEAR)
    pixels = list(small.getdata())
    if not pixels:
        return 0.5

    def channel(value: int) -> float:
        v = value / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    total = 0.0
    for r, g, b in pixels:
        total += 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    return round(total / len(pixels), 4)


def _render_variants(raw: bytes, asset: MediaAsset) -> dict[str, str]:
    with Image.open(io.BytesIO(raw)) as image:
        # EXIF-поворот: фотографии с телефона иначе лягут боком.
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        asset.width, asset.height = image.size
        asset.luminance = _mean_luminance(image)

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


@shared_task(acks_late=True, max_retries=0, ignore_result=True)
def purge_hotel_media(hotel_id: str, object_keys: list[str], asset_count: int) -> dict:
    """
    Удалить объекты отеля из хранилища и ЗАПИСАТЬ ИСХОД В ОТЕЛЬ.

    ФОНОВОЙ ЗАДАЧЕЙ, а не в запросе: у отеля бывают тысячи объектов, и
    офбординг крупного отеля повесил бы HTTP-запрос до таймаута.

    ИСХОД ПИШЕТСЯ В ОТМЕТКУ ОФБОРДИНГА, а не только в лог. «Данные отеля
    удалены» — обещание, которое отель может проверить; основывать его на
    строке в логе, которую никто не читает, нельзя. Пока хранилище не
    отчиталось, отметка держит состояние `pending`, а при отказе — `failed`
    вместе с числом неудалённых объектов, чтобы оператор увидел и повторил.
    """
    from apps.hotels.services.offboarding import record_storage_purge
    from apps.media.services import storage

    result = storage.delete_objects(object_keys)
    outcome = {
        "state": "done" if not result["failed"] else "failed",
        "assets": asset_count,
        "objects": len(object_keys),
        "deleted": len(result["deleted"]),
        "failed": len(result["failed"]),
        # Ключи, которые не ушли, — чтобы повтор не начинался с нуля.
        "failed_keys": result["failed"][:200],
    }
    record_storage_purge(hotel_id, outcome)
    return outcome
