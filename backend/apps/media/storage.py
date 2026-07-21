"""
Клиент MinIO. Единственное место в проекте, которое знает про S3-протокол.
"""

from __future__ import annotations

import functools
import io
import logging

from django.conf import settings
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def get_client() -> Minio:
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )


def ensure_bucket() -> None:
    client = get_client()
    if not client.bucket_exists(settings.MINIO_BUCKET):
        client.make_bucket(settings.MINIO_BUCKET)
        logger.info("Создан бакет %s", settings.MINIO_BUCKET)


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    ensure_bucket()
    get_client().put_object(
        settings.MINIO_BUCKET,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return key


def get_bytes(key: str) -> bytes:
    response = get_client().get_object(settings.MINIO_BUCKET, key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def delete_object(key: str) -> None:
    try:
        get_client().remove_object(settings.MINIO_BUCKET, key)
    except S3Error:
        logger.warning("Не удалось удалить объект %s", key, exc_info=True)


def object_key(hotel_id, kind: str, filename: str, *, variant: str = "original") -> str:
    return f"hotels/{hotel_id}/{kind}/{variant}/{filename}"
