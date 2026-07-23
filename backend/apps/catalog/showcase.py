"""
Витрина главной: bento-плитки сервисов отеля.

Три уровня иерархии витрины: (1) главная — плитки СЕРВИСОВ, а не блюд; (2) список
заведений категории; (3) существующий каталог продуктов заведения. Этот модуль
строит первый уровень.

«Заведение» = точка исполнения (ExecutionPoint, в CMS «отдел»): у неё есть фото,
расписание, название, и на неё маршрутизируются категории (Route). Плитка
заведения показывается только если у точки есть ≥1 активная категория — иначе
входить некуда. Точки одного рода (рестораны = кухня+бар, спа, услуги)
группируются: их ≤ порога — отдельные плитки, больше — одна плитка-категория.

Набор плиток ВЫЧИСЛЯЕМЫЙ; ShowcaseTile лишь накладывает размер/порядок/показ по
стабильному ключу (код точки, код группы, «info», «room-control»).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from apps.core.fields import translate
from apps.hotels.models import ExecutionPoint, Hotel, ShowcaseTile
from apps.media.services import image_url

from .models import Category, OfferingType

# Точка какого рода в какую группу главной попадает. Рестораны — это кухни и
# бары вместе (у ресторана может быть и то, и другое). Порог группировки
# считается ПО ГРУППЕ.
KIND_GROUP = {
    ExecutionPoint.Kind.KITCHEN: "restaurants",
    ExecutionPoint.Kind.BAR: "restaurants",
    ExecutionPoint.Kind.SPA: "spa",
    ExecutionPoint.Kind.HOUSEKEEPING: "services",
    ExecutionPoint.Kind.RECEPTION: "services",
    ExecutionPoint.Kind.OTHER: "services",
}

# Порядок групп на главной и их локализованный титул/подпись-плюрал.
GROUP_ORDER = ["restaurants", "spa", "services"]
GROUP_TITLES = {
    "restaurants": {"ru": "Рестораны", "en": "Restaurants", "ar": "المطاعم", "zh": "餐厅"},
    "spa": {"ru": "Спа и велнес", "en": "Spa & wellness", "ar": "سبا وعافية", "zh": "水疗与养生"},
    "services": {"ru": "Услуги", "en": "Services", "ar": "الخدمات", "zh": "服务"},
}
# Подпись рода на плитке одиночного заведения.
KIND_LABELS = {
    ExecutionPoint.Kind.KITCHEN: {"ru": "Ресторан", "en": "Restaurant", "ar": "مطعم", "zh": "餐厅"},
    ExecutionPoint.Kind.BAR: {"ru": "Бар", "en": "Bar", "ar": "بار", "zh": "酒吧"},
    ExecutionPoint.Kind.SPA: {"ru": "Спа", "en": "Spa", "ar": "سبا", "zh": "水疗"},
    ExecutionPoint.Kind.HOUSEKEEPING: {"ru": "Сервис", "en": "Service", "ar": "خدمة", "zh": "服务"},
    ExecutionPoint.Kind.RECEPTION: {"ru": "Консьерж", "en": "Concierge", "ar": "الكونسيرج", "zh": "礼宾"},
    ExecutionPoint.Kind.OTHER: {"ru": "Сервис", "en": "Service", "ar": "خدمة", "zh": "服务"},
}
INFO_TITLE = {"ru": "Об отеле", "en": "About the hotel", "ar": "عن الفندق", "zh": "酒店信息"}
ROOM_CONTROL_TITLE = {"ru": "Мой номер", "en": "My room", "ar": "غرفتي", "zh": "我的房间"}


def _point_image(point: ExecutionPoint) -> str | None:
    """Обложка заведения: фото точки → фото первой её категории → None.

    Дальше каскад продолжает фронт (фон бренда → градиент токенов), поэтому
    здесь на пустом фото возвращаем None, а не платформенную заглушку.
    """
    if point.image_id:
        url = point.image.url("card")
        if url:
            return url
    category = (
        Category.objects.filter(
            is_active=True, routes__execution_point=point, routes__is_active=True, image__isnull=False
        )
        .select_related("image")
        .order_by("sort_order", "code")
        .first()
    )
    if category and category.image_id:
        return image_url(category.image, variant="card", fallback_code=None)
    return None


def _point_status(point: ExecutionPoint, moment: datetime | None) -> dict[str, Any] | None:
    """Структурный статус заведения по расписанию; строки локализует фронт."""
    if point.schedule_id is None:
        return None
    avail = point.schedule.availability_at(moment)
    if avail.is_open:
        return {"state": "open", "until": avail.available_until, "opens_at": None}
    return {"state": "closed", "until": None, "opens_at": avail.available_from}


def _venue_points(hotel: Hotel) -> list[ExecutionPoint]:
    """Точки с ≥1 активной категорией — те, у кого есть куда войти."""
    return list(
        ExecutionPoint.objects.filter(
            is_active=True, routes__is_active=True, routes__category__is_active=True
        )
        .select_related("schedule", "image")
        .prefetch_related("schedule__intervals")
        .distinct()
        .order_by("code")
    )


def _overlay_index(hotel: Hotel) -> dict[str, ShowcaseTile]:
    return {tile.key: tile for tile in ShowcaseTile.objects.all()}


def _apply_overlay(tile: dict[str, Any], overlay: ShowcaseTile | None, default_order: int, default_size: str) -> dict[str, Any] | None:
    """Наложить настройки CMS. Выключенная плитка исчезает (None)."""
    if overlay is not None and not overlay.is_enabled:
        return None
    tile["size"] = (overlay.size if overlay else default_size)
    tile["order"] = (overlay.sort_order if overlay and overlay.sort_order else default_order)
    return tile


def build_showcase(hotel: Hotel, *, language: str | None = None, moment: datetime | None = None) -> list[dict[str, Any]]:
    """Плитки главной-витрины тенанта в порядке показа."""
    overlays = _overlay_index(hotel)
    threshold = hotel.showcase_group_threshold or 3

    # Заведения по группам, в стабильном порядке групп.
    groups: dict[str, list[ExecutionPoint]] = {key: [] for key in GROUP_ORDER}
    for point in _venue_points(hotel):
        groups.setdefault(KIND_GROUP.get(point.kind, "services"), []).append(point)

    tiles: list[dict[str, Any]] = []
    order = 0
    for group_key in GROUP_ORDER:
        points = groups.get(group_key) or []
        if not points:
            continue
        if len(points) > threshold:
            # Свёрнутая плитка-категория с превью обложек заведений внутри.
            previews = [img for img in (_point_image(p) for p in points) if img][:4]
            base = {
                "key": group_key,
                "type": "service-category",
                "title": translate(GROUP_TITLES[group_key], language),
                "subtitle": None,
                "kind": None,
                "venue_count": len(points),
                "status": None,
                "image": previews[0] if previews else None,
                "cover_previews": previews,
                "route": f"/category/{group_key}",
                "enabled": True,
            }
            applied = _apply_overlay(base, overlays.get(group_key), order, "l")
            if applied:
                tiles.append(applied)
                order += 1
        else:
            for point in points:
                base = {
                    "key": point.code,
                    "type": "venue",
                    "title": translate(point.title, language) or point.code,
                    "subtitle": translate(KIND_LABELS.get(point.kind, {}), language) or None,
                    "kind": point.kind,
                    "venue_count": None,
                    "status": _point_status(point, moment),
                    "image": _point_image(point),
                    "cover_previews": [],
                    "route": f"/venue/{point.code}",
                    "enabled": True,
                }
                applied = _apply_overlay(base, overlays.get(point.code), order, "m")
                if applied:
                    tiles.append(applied)
                    order += 1

    # Инфо-плитка — если у отеля есть активные инфо-категории.
    if Category.objects.filter(type=OfferingType.INFO, is_active=True).exists():
        info = {
            "key": "info",
            "type": "info",
            "title": translate(INFO_TITLE, language),
            "subtitle": None,
            "kind": None,
            "venue_count": None,
            "status": None,
            "image": None,
            "cover_previews": [],
            "route": "/info",
            "enabled": True,
        }
        applied = _apply_overlay(info, overlays.get("info"), order, "s")
        if applied:
            tiles.append(applied)
            order += 1

    # «Мой номер» — заглушка за флагом (GRMS-фаза). По умолчанию выключена и не
    # показывается; отель включает превью флагом, плитка приходит disabled.
    if (hotel.settings or {}).get("show_room_control"):
        room = {
            "key": "room-control",
            "type": "room-control",
            "title": translate(ROOM_CONTROL_TITLE, language),
            "subtitle": None,
            "kind": None,
            "venue_count": None,
            "status": None,
            "image": None,
            "cover_previews": [],
            "route": None,
            "enabled": False,
        }
        applied = _apply_overlay(room, overlays.get("room-control"), order, "m")
        if applied:
            tiles.append(applied)
            order += 1

    tiles.sort(key=lambda entry: entry["order"])
    return tiles


def _venue_card(point: ExecutionPoint, language: str | None, moment: datetime | None) -> dict[str, Any]:
    return {
        "code": point.code,
        "title": translate(point.title, language) or point.code,
        "subtitle": translate(KIND_LABELS.get(point.kind, {}), language) or None,
        "kind": point.kind,
        "image": _point_image(point),
        "status": _point_status(point, moment),
        "route": f"/venue/{point.code}",
    }


def list_venues(
    hotel: Hotel, group: str, *, language: str | None = None, moment: datetime | None = None
) -> dict[str, Any]:
    """Уровень 2: карточки заведений одной группы (рестораны/спа/услуги)."""
    cards = [
        _venue_card(point, language, moment)
        for point in _venue_points(hotel)
        if KIND_GROUP.get(point.kind, "services") == group
    ]
    return {
        "group": group,
        "title": translate(GROUP_TITLES.get(group, {}), language) or group,
        "venues": cards,
    }
