"""
CMS: загрузка изображений и статус обработки.

Вьюхи переехали из api/cms/common.py: файл был «общим», а эти два эндпоинта
принадлежат медиатеке. Ограничения загрузки держим ЗДЕСЬ, а не в настройках:
это контракт API, и он должен читаться рядом с эндпоинтом.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import File, Router
from ninja.files import UploadedFile

from apps.core.errors import ValidationError
from apps.media.schemas import CropIn, MediaOut
from apps.media.services import get_asset, serialize_asset, set_crop, upload_asset

router = Router(tags=["cms"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/media", response={201: MediaOut}, summary="Загрузить изображение")
def upload_media(request: HttpRequest, file: UploadedFile = File(...), kind: str = "item"):
    """
    Оригинал сразу уезжает в MinIO, варианты режет Celery. Ответ приходит со
    статусом `pending` — клиент показывает локальное превью и опрашивает
    `GET /media/{id}`, пока статус не станет `ready`.
    """
    from apps.media.models import MediaAsset

    if file.size and file.size > MAX_UPLOAD_BYTES:
        raise ValidationError(
            f"Файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ",
            field="file",
            code="file_too_large",
        )
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            "Поддерживаются только JPEG, PNG и WebP",
            field="file",
            code="unsupported_media",
        )
    if kind not in dict(MediaAsset.Kind.choices):
        kind = MediaAsset.Kind.ITEM

    asset = upload_asset(
        content=file.read(),
        filename=file.name or "upload",
        kind=kind,
        content_type=content_type,
    )
    return 201, serialize_asset(asset)


@router.get("/media/{asset_id}", response=MediaOut, summary="Статус изображения")
def get_media(request: HttpRequest, asset_id: str):
    return serialize_asset(get_asset(asset_id))


@router.put("/media/{asset_id}/crop", response=MediaOut, summary="Выбрать кадр")
def set_media_crop(request: HttpRequest, asset_id: str, payload: CropIn):
    """
    Кадр хранится КООРДИНАТАМИ, оригинал не переписывается никогда.

    Поэтому обрезку можно переоткрыть через неделю и увидеть всю картинку:
    варианты каждый раз режутся заново из исходника, а не из прошлого
    результата. `crop: null` снимает рамку и возвращает кадр целиком.

    Ответ приходит со статусом `pending` — как и при загрузке: нарезка идёт в
    воркере, и до её конца на экране честно старые варианты.
    """
    if payload.crop is not None:
        missing = {"x", "y", "w", "h"} - set(payload.crop)
        if missing:
            raise ValidationError(
                "В рамке не хватает полей: " + ", ".join(sorted(missing)),
                field="crop",
                code="bad_crop",
            )
    return serialize_asset(set_crop(asset_id, crop=payload.crop, ratio=payload.ratio))
