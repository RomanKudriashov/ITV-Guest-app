"""
Сервисный слой медиа. Вьюхи не трогают ни MinIO, ни Celery напрямую.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from django.db import transaction

from apps.core.context import require_hotel_id

from apps.media.services import storage
from apps.media.models import CategoryPlaceholder, MediaAsset


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
    # Задача импортируется ЗДЕСЬ, а не в шапке: пакет сервисов реэкспортирует
    # этот модуль, а задача берёт из него же хранилище — импорт в шапке
    # замыкает кольцо и роняет сборку.
    from apps.media.tasks import process_media_asset

    # Строго после коммита: воркер живёт в другом процессе и, поставленный в
    # очередь раньше, успевает прочитать базу до того, как в ней появится
    # ассет. То же правило, что и для событийной шины.
    transaction.on_commit(
        lambda: process_media_asset.delay(str(asset.pk), str(hotel_id))
    )
    return asset


def get_asset(asset_id) -> MediaAsset:
    """Ассет по идентификатору. Выборка — работа сервиса, вьюха её зовёт."""
    from apps.core.errors import NotFoundError

    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise NotFoundError("Изображение не найдено")
    return asset


def serialize_asset(asset: MediaAsset | None) -> dict | None:
    """
    Единый вид медиа-ассета для CMS. Пока варианты не нарезаны, URL'ы пустые —
    UI показывает локальное превью и опрашивает статус.
    """
    if asset is None:
        return None
    return {
        "id": str(asset.pk),
        "status": asset.status,
        "url": asset.url("card"),
        "thumb_url": asset.url("thumb"),
        "original_filename": asset.original_filename,
    }


def image_url(asset: MediaAsset | None, *, variant: str = "card", fallback_code: str = "") -> str:
    """Единая точка получения картинки: ассет → заглушка по категории → пусто."""
    if asset is not None:
        url = asset.url(variant)
        if url:
            return url
    return CategoryPlaceholder.url_for(fallback_code or "default")


def object_keys_of(asset: MediaAsset) -> list[str]:
    """
    Все объекты ассета: оригинал и нарезанные варианты.

    Вариантов может не быть (нарезка не дошла) — тогда останется один оригинал.
    Пустые значения отбрасываем: ключ, которого нет, удалять нечего.
    """
    keys = [asset.object_key, *(asset.variants or {}).values()]
    seen: list[str] = []
    for key in keys:
        if key and key not in seen:
            seen.append(key)
    return seen


def hotel_object_keys(hotel) -> tuple[int, list[str]]:
    """
    Ключи всех объектов отеля — ПО БАЗЕ, а не по префиксу в бакете.

    Возвращает число ассетов и список ключей. Именно этот список уезжает в
    удаление: перечисление по базе означает, что мы удаляем ровно то, что сами
    же и записали, а не всё, что похоже на путь отеля.

    Читаем В КОНТЕКСТЕ ОТЕЛЯ, а не платформенным подключением: строки медиа
    закрыты RLS по `hotel_id`, и роль без BYPASSRLS увидит пустой список —
    молча, без ошибки. Тогда офбординг решил бы, что удалять нечего.

    `all_objects` — потому что мягко удалённый ассет это тоже файл в бакете.
    """
    from apps.core.context import tenant_context

    with tenant_context(hotel):
        assets = list(MediaAsset.all_objects.all())
    keys: list[str] = []
    for asset in assets:
        keys.extend(object_keys_of(asset))
    return len(assets), keys
