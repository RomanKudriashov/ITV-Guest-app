"""
CMS: bootstrap, медиа, расписания.
"""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest
from ninja import File, Router
from ninja.files import UploadedFile

from apps.catalog.vocabularies import ALLERGENS, DAY_PARTS, FLAGS
from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError, ValidationError
from apps.hotels import services as schedule_svc
from apps.hotels.models import ExecutionPoint, Hotel, HotelLanguage
from apps.media.models import MediaAsset
from apps.media.services import serialize_asset, upload_asset

from .schemas import (
    BootstrapOut,
    MediaOut,
    OkOut,
    ScheduleIn,
    ScheduleOut,
    SchedulePatch,
)

router = Router(tags=["cms"])

# Ограничения загрузки. Держим здесь, а не в настройках: это контракт API,
# и он должен читаться рядом с эндпоинтом.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/bootstrap", response=BootstrapOut, summary="Всё для старта CMS")
def bootstrap(request: HttpRequest):
    hotel = Hotel.objects.get(pk=require_hotel_id())
    languages = list(
        HotelLanguage.objects.filter(is_active=True)
        .order_by("sort_order", "code")
        .values("code", "title", "is_default")
    )
    if not languages:
        languages = [
            {"code": code, "title": code.upper(), "is_default": code == hotel.default_language}
            for code in settings.SUPPORTED_LANGUAGES
        ]

    return {
        "hotel": {
            "id": str(hotel.pk),
            "name": hotel.name,
            "subdomain": hotel.subdomain,
            "currency": hotel.currency,
            "currency_minor_units": hotel.currency_minor_units,
            "timezone": hotel.timezone,
            "default_language": hotel.default_language,
        },
        "languages": languages,
        "flags": FLAGS,
        "allergens": ALLERGENS,
        "schedules": schedule_svc.list_schedules(),
        "execution_points": [
            {"id": str(point.pk), "code": point.code, "title": point.title or {}}
            for point in ExecutionPoint.objects.filter(is_active=True).order_by("code")
        ],
        "day_parts": DAY_PARTS,
    }


# --- Медиа -----------------------------------------------------------------


@router.post("/media", response={201: MediaOut}, summary="Загрузить изображение")
def upload_media(request: HttpRequest, file: UploadedFile = File(...), kind: str = "item"):
    """
    Оригинал сразу уезжает в MinIO, варианты режет Celery. Ответ приходит со
    статусом `pending` — клиент показывает локальное превью и опрашивает
    `GET /media/{id}`, пока статус не станет `ready`.
    """
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
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise NotFoundError("Изображение не найдено")
    return serialize_asset(asset)


# --- Расписания ------------------------------------------------------------


@router.get("/schedules", response=list[ScheduleOut], summary="Расписания")
def list_schedules(request: HttpRequest):
    return schedule_svc.list_schedules()


@router.post("/schedules", response={201: ScheduleOut}, summary="Создать расписание")
def create_schedule(request: HttpRequest, payload: ScheduleIn):
    schedule = schedule_svc.create_schedule(payload.dict(exclude_unset=True))
    return 201, schedule_svc.serialize_schedule(schedule)


@router.patch("/schedules/{schedule_id}", response=ScheduleOut, summary="Изменить расписание")
def update_schedule(request: HttpRequest, schedule_id: str, payload: SchedulePatch):
    schedule = schedule_svc.update_schedule(schedule_id, payload.dict(exclude_unset=True))
    return schedule_svc.serialize_schedule(schedule)


@router.delete("/schedules/{schedule_id}", response=OkOut, summary="Удалить расписание")
def delete_schedule(request: HttpRequest, schedule_id: str):
    schedule_svc.delete_schedule(schedule_id)
    return {"ok": True}
