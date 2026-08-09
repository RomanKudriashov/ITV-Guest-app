"""
Клиент MinIO. Единственное место в проекте, которое знает про S3-протокол.
"""

from __future__ import annotations

import functools
import io
import json
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


# Картинки меню — публичный контент: гость открывает витрину без авторизации,
# и подписывать каждый URL значило бы либо гонять ссылки через бэкенд, либо
# ломать кэширование на CDN. Поэтому бакет доступен на чтение анонимно, а
# запись остаётся закрытой ключами.
_PUBLIC_READ_POLICY = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": [f"arn:aws:s3:::{{bucket}}/*"],
        }
    ],
}


@functools.lru_cache(maxsize=1)
def ensure_bucket() -> None:
    """
    Создаёт бакет и выставляет политику публичного чтения.

    Результат кэшируется: вызывается на каждую загрузку, а лишние обращения к
    MinIO на горячем пути ни к чему.
    """
    client = get_client()
    bucket = settings.MINIO_BUCKET
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        logger.info("Создан бакет %s", bucket)

    policy = json.dumps(_PUBLIC_READ_POLICY).replace("{bucket}", bucket)
    try:
        client.set_bucket_policy(bucket, policy)
    except S3Error:
        logger.warning("Не удалось выставить политику чтения на %s", bucket, exc_info=True)


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
