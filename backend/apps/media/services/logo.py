"""
Логотип отеля — без потерь, но по размеру места (партия 61).

Решение 16 (`docs/decisions.md`) отдаёт логотип исходником: WebP с потерями
мылил контур букв. Но исходник бывает шириной 3513 точек, а показывается
логотип не шире 200 CSS px (экран входа; шапка телефона — 88). Вариант `logo`
— тот же логотип, уменьшенный до `LOGO_WIDTH` (×2 от наибольшего места с
запасом) и сохранённый WebP БЕЗ ПОТЕРЬ с прозрачностью: контур тот же, байтов
меньше. Исходник хранится как был — к нему возвращаются при перенарезке.

SVG не трогаем: вектор и так лёгкий и резкий на любой ширине. Вариант,
оказавшийся не легче исходника, не кладём — отдаём исходник.
"""

from __future__ import annotations

import io
import uuid

from apps.media.models import MediaAsset
from apps.media.services import storage

LOGO_WIDTH = 480
VARIANT = "logo"


def ensure_logo_variant(asset: MediaAsset) -> str | None:
    """Ключ варианта `logo` (заведёт, если нет); `None` — отдавать исходник."""
    from PIL import Image, ImageOps

    variants = dict(asset.variants or {})
    if variants.get(VARIANT):
        return variants[VARIANT]
    if not asset.object_key or "svg" in (asset.content_type or "").lower():
        return None
    raw = storage.get_bytes(asset.object_key)
    with Image.open(io.BytesIO(raw)) as image:
        image = ImageOps.exif_transpose(image)
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail((LOGO_WIDTH, LOGO_WIDTH * 4), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", lossless=True, quality=100, method=6)
    body = buffer.getvalue()
    if len(body) >= len(raw):
        return None
    key = storage.object_key(asset.hotel_id, asset.kind, f"{uuid.uuid4().hex}.webp", variant=VARIANT)
    storage.put_bytes(key, body, content_type="image/webp")
    variants[VARIANT] = key
    MediaAsset.all_objects.filter(pk=asset.pk).update(variants=variants)
    asset.variants = variants
    return key
