"""
Сервисный слой медиа. Вьюхи не трогают ни MinIO, ни Celery напрямую.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from django.db import transaction

from apps.core.context import require_hotel_id

from apps.media.services import storage
from apps.media.models import MediaAsset


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


def store_ready_asset(
    *,
    content: bytes,
    filename: str,
    kind: str,
    content_type: str,
) -> MediaAsset:
    """
    Файл, которому нечего обрабатывать: кладём и сразу считаем готовым.

    Отдельно от `upload_asset`, потому что тот СТАВИТ ЗАДАЧУ НАРЕЗКИ. Для
    шрифта это не «лишняя работа», а падение: Pillow открывает woff2 и не
    понимает, что ему принесли, ассет уходит в FAILED — и файл, который лежит в
    хранилище целым, числится сломанным.
    """
    hotel_id = require_hotel_id()
    safe_name = f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"
    key = storage.object_key(hotel_id, kind, safe_name)
    storage.put_bytes(key, content, content_type=content_type)

    return MediaAsset.objects.create(
        kind=kind,
        status=MediaAsset.Status.READY,
        object_key=key,
        original_filename=filename[:255],
        content_type=content_type,
        size_bytes=len(content),
    )


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
        # Исходник и рамка — только для редактора кадра. Гостевые ручки этот
        # сериализатор не зовут: он живёт в CMS.
        "original_url": asset.original_url(),
        "crop": asset.crop,
        "crop_ratio": asset.crop_ratio,
        "focus": asset.focus or {"x": 0.5, "y": 0.5},
        # Объект картинки (партия 58а): списки и предпросмотры CMS берут файл
        # по ширине места, как витрина.
        "ref": image_ref(asset),
    }


def set_crop(asset_id, *, crop: dict | None, ratio: float | None) -> MediaAsset:
    """
    Старый редактор кадра (до партии 58в): записать рамку и ФОКУС по её центру.

    Вариантов по рамке больше не режем (партия 58а): они — целый оригинал, а
    место показа кладёт фото по фокусу. Рамка хранится на релиз — редактор
    переоткрывает её такой, какой человек её оставил.

    Нарезка ставится, только если у ассета ещё старая (`card`/`full` по рамке):
    тогда он заодно переезжает на ряд ширин.
    """
    from apps.media.tasks import focus_from_crop, process_media_asset

    asset = get_asset(asset_id)
    if asset.content_type == "image/svg+xml":
        # Вектор не режется на варианты — и кадрировать его нечем: рамку
        # задаёт сам файл. Отказ словами, а не упавшая нарезка (партия 25).
        from apps.core.errors import ValidationError

        raise ValidationError("SVG не кадрируется — рамку задаёт сам файл", code="svg_no_crop")
    asset.crop = crop or None
    asset.crop_ratio = ratio
    asset.focus = focus_from_crop(asset.crop)
    fields = ["crop", "crop_ratio", "focus", "updated_at"]
    legacy = not asset.width_variants()
    if legacy:
        asset.status = MediaAsset.Status.PENDING
        fields.append("status")
    asset.save(update_fields=fields)

    if legacy:
        hotel_id = require_hotel_id()
        transaction.on_commit(lambda: process_media_asset.delay(str(asset.pk), str(hotel_id)))
    return asset


def image_ref(asset: MediaAsset | None) -> dict | None:
    """
    ОБЪЕКТ КАРТИНКИ (партия 58а) — единый вид фото для гостя и CMS.

        {"src": url, "widths": [{"w": 400, "url": ...}, ...], "w": 3624, "h": 1510,
         "focus": {"x": .5, "y": .5}, "color": "#7a6b5c", "luminance": 0.31}

    `widths` — для `srcset`: место показа само выбирает файл по `sizes`.
    `w`/`h` — форма КАДРА, который лежит в файлах: витрина считает по ней,
    сколько фото уцелеет в месте, и при < 60% показывает его целиком.
    `src` — средняя ширина (800 или ближайшая): запасной адрес без srcset.

    Ассет до перенарезки: ширины — его старые `card`/`full`, а форма — его
    рамки, потому что эти файлы вырезаны по ней.
    """
    if asset is None:
        return None
    from django.conf import settings

    w, h = asset.width, asset.height
    focus = asset.focus or {"x": 0.5, "y": 0.5}
    series = asset.width_variants()
    if series:
        widths = [{"w": width, "url": asset.key_url(key)} for width, key in series]
        # Миниатюра — тоже ширина ряда (200, в пропорциях оригинала): значку
        # 56×56 в поиске и корзине браузер возьмёт её, а не 400.
        thumb = (asset.variants or {}).get("thumb")
        if thumb and w and widths[0]["w"] > settings.MEDIA_THUMB_WIDTH:
            widths.insert(0, {"w": min(settings.MEDIA_THUMB_WIDTH, w), "url": asset.key_url(thumb)})
    else:
        crop = asset.crop or None
        if w and h and crop:
            w, h = round(w * float(crop.get("w", 1))), round(h * float(crop.get("h", 1)))
            focus = {"x": 0.5, "y": 0.5}  # файл уже вырезан по рамке
        widths = []
        for name, width in settings.MEDIA_LEGACY_VARIANT_WIDTH.items():
            key = (asset.variants or {}).get(name)
            if key:
                widths.append({"w": min(width, w) if w else width, "url": asset.key_url(key)})
        if not widths:
            url = asset.url("original")
            if not url:
                return None
            widths = [{"w": w or 0, "url": url}]
    src = next((x["url"] for x in widths if x["w"] >= 800), widths[-1]["url"])
    return {
        "src": src,
        "widths": widths,
        "w": w,
        "h": h,
        "focus": {"x": float(focus.get("x", 0.5)), "y": float(focus.get("y", 0.5))},
        "color": asset.average_color or None,
        "luminance": asset.luminance,
    }


def image_url(asset: MediaAsset | None, *, variant: str = "card") -> str:
    """
    Единая точка получения картинки: ассет → пусто.

    ЗАГЛУШКИ НА СЕРВЕРЕ БОЛЬШЕ НЕТ (партия 29, п.61 бэклога). Раньше на месте
    пустого фото отдавался `/static/placeholders/<код>.svg` — файлов таких нет
    (локально 404, на стенде `index.html` витрины), и каждая позиция без фото
    делала запрос в никуда, а витрина всё равно рисовала свой знак. Теперь
    пусто значит пусто: знак по типу заведения рисует витрина.
    """
    if asset is not None:
        url = asset.url(variant)
        if url:
            return url
    return ""


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
