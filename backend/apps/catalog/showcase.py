"""
Витрина главной: bento-плитки сервисов отеля.

Три уровня иерархии витрины: (1) главная — плитки СЕРВИСОВ, а не блюд; (2) список
заведений категории; (3) существующий каталог продуктов заведения. Этот модуль
строит первый уровень.

«Заведение» = гостевой сервис (Service): у него есть тип-шаблон, фото, венью-часы,
имя и исполнитель (ExecutionPoint), на которого маршрутизируются категории
(Route). Плитка показывается только если у исполнителя есть ≥1 активная категория —
иначе входить некуда. Сервисы одного рода (рестораны, спа, услуги) группируются:
их ≤ порога — отдельные плитки, больше — одна плитка-категория.

Набор плиток ВЫЧИСЛЯЕМЫЙ; ShowcaseTile лишь накладывает размер/порядок/показ по
стабильному ключу (код сервиса, код группы, «info», «room-control»).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from apps.core.fields import translate
from apps.hotels.models import Hotel, Service, ShowcaseTile
from apps.media.services import image_url

from .models import Category, OfferingType

# Тип сервиса → группа главной. Рестораны — еда и напитки вместе (ресторан, бар,
# рум-сервис, мини-бар); спа — спа и бассейн; остальное — услуги. Порог
# группировки считается ПО ГРУППЕ. Синхронно с миграцией kind→type: kitchen→
# restaurant→restaurants, bar→bar→restaurants, spa→spa, reception→concierge→
# services, housekeeping→services — так группировка не меняется для старых точек.
SERVICE_TYPE_GROUP = {
    Service.Type.RESTAURANT: "restaurants",
    Service.Type.BAR: "restaurants",
    Service.Type.ROOM_SERVICE: "restaurants",
    Service.Type.MINIBAR: "restaurants",
    Service.Type.SPA: "spa",
    Service.Type.POOL: "spa",
    Service.Type.TRANSFER: "services",
    Service.Type.CONCIERGE: "services",
    Service.Type.EXCURSIONS: "services",
    Service.Type.HOUSEKEEPING: "services",
    Service.Type.INFO: "services",
    Service.Type.CUSTOM: "services",
}

# Порядок групп на главной и их локализованный титул/подпись-плюрал.
GROUP_ORDER = ["restaurants", "spa", "services"]
GROUP_TITLES = {
    "restaurants": {"ru": "Рестораны", "en": "Restaurants", "ar": "المطاعم", "zh": "餐厅"},
    "spa": {"ru": "Спа и велнес", "en": "Spa & wellness", "ar": "سبا وعافية", "zh": "水疗与养生"},
    "services": {"ru": "Услуги", "en": "Services", "ar": "الخدمات", "zh": "服务"},
}
INFO_TITLE = {"ru": "Об отеле", "en": "About the hotel", "ar": "عن الفندق", "zh": "酒店信息"}
ROOM_CONTROL_TITLE = {"ru": "Мой номер", "en": "My room", "ar": "غرفتي", "zh": "我的房间"}


def _service_image(service: Service) -> str | None:
    """Обложка заведения: фото сервиса → фото первой его категории → None.

    Дальше каскад продолжает фронт (фон бренда → градиент токенов), поэтому
    здесь на пустом фото возвращаем None, а не платформенную заглушку.
    """
    if service.image_id:
        url = service.image.url("card")
        if url:
            return url
    category = (
        Category.objects.filter(
            is_active=True,
            routes__execution_point_id=service.execution_point_id,
            routes__is_active=True,
            image__isnull=False,
        )
        .select_related("image")
        .order_by("sort_order", "code")
        .first()
    )
    if category and category.image_id:
        return image_url(category.image, variant="card", fallback_code=None)
    return None


def _service_status(service: Service, moment: datetime | None) -> dict[str, Any] | None:
    """Структурный статус заведения по венью-расписанию; строки локализует фронт."""
    if service.schedule_id is None:
        return None
    avail = service.schedule.availability_at(moment)
    if avail.is_open:
        return {"state": "open", "until": avail.available_until, "opens_at": None}
    return {"state": "closed", "until": None, "opens_at": avail.available_from}


def _venues(hotel: Hotel) -> list[Service]:
    """
    Заведения для витрины: гостевые сервисы, у исполнителя которых есть ≥1
    активная замаршрутизированная активная категория. Служебный сервис
    (is_guest_facing=false) не появляется, даже если на него что-то
    замаршрутизировано.
    """
    return list(
        Service.objects.filter(
            is_active=True,
            is_guest_facing=True,
            execution_point__routes__is_active=True,
            execution_point__routes__category__is_active=True,
        )
        .select_related("schedule", "image", "execution_point")
        .prefetch_related("schedule__intervals")
        .distinct()
        .order_by("code")
    )


def _overlay_index(hotel: Hotel) -> dict[str, ShowcaseTile]:
    return {tile.key: tile for tile in ShowcaseTile.objects.all()}


def _apply_overlay(
    tile: dict[str, Any],
    overlay: ShowcaseTile | None,
    default_order: int,
    default_size: str,
    include_hidden: bool,
) -> dict[str, Any] | None:
    """
    Наложить настройки CMS. Скрытая отелем плитка исчезает из гостевой выдачи
    (None), но остаётся для CMS-редактора (include_hidden) с `shown=False`, чтобы
    её можно было вернуть.
    """
    shown = not (overlay is not None and not overlay.is_enabled)
    if not shown and not include_hidden:
        return None
    # Первая плитка по умолчанию крупная (L) — визуальный якорь bento; CMS
    # может переопределить размер.
    base_size = "l" if default_order == 0 else default_size
    tile["size"] = (overlay.size if overlay else base_size)
    tile["order"] = (overlay.sort_order if overlay and overlay.sort_order else default_order)
    tile["shown"] = shown
    return tile


def build_showcase(
    hotel: Hotel, *, language: str | None = None, moment: datetime | None = None, include_hidden: bool = False
) -> list[dict[str, Any]]:
    """Плитки главной-витрины тенанта в порядке показа.

    include_hidden — вернуть и скрытые отелем плитки (для CMS-редактора).
    """
    overlays = _overlay_index(hotel)
    # 0 — валидный порог («всегда сворачивать»); `or 3` съел бы его.
    threshold = 3 if hotel.showcase_group_threshold is None else hotel.showcase_group_threshold

    # Заведения по группам, в стабильном порядке групп.
    groups: dict[str, list[Service]] = {key: [] for key in GROUP_ORDER}
    for service in _venues(hotel):
        groups.setdefault(SERVICE_TYPE_GROUP.get(service.type, "services"), []).append(service)

    tiles: list[dict[str, Any]] = []
    order = 0
    for group_key in GROUP_ORDER:
        services = groups.get(group_key) or []
        if not services:
            continue
        if len(services) > threshold:
            # Свёрнутая плитка-категория с превью обложек заведений внутри.
            previews = [img for img in (_service_image(s) for s in services) if img][:4]
            base = {
                "key": group_key,
                "type": "service-category",
                "title": translate(GROUP_TITLES[group_key], language),
                "subtitle": None,
                "kind": None,
                "venue_count": len(services),
                "status": None,
                "image": previews[0] if previews else None,
                "cover_previews": previews,
                "route": f"/category/{group_key}",
                "enabled": True,
            }
            applied = _apply_overlay(base, overlays.get(group_key), order, "l", include_hidden)
            if applied:
                tiles.append(applied)
                order += 1
        else:
            for service in services:
                base = {
                    "key": service.code,
                    "type": "venue",
                    "title": translate(service.public_title, language) or service.code,
                    # Подпись — только tagline. Тип на плитке не показываем;
                    # нет tagline → фронт покажет часы/статус.
                    "subtitle": translate(service.tagline, language) or None,
                    # Род исполнителя (kitchen/bar/spa…) — как и раньше, чтобы
                    # payload витрины не менялся.
                    "kind": service.execution_point.kind,
                    "venue_count": None,
                    "status": _service_status(service, moment),
                    "image": _service_image(service),
                    "cover_previews": [],
                    "route": f"/venue/{service.code}",
                    "enabled": True,
                }
                applied = _apply_overlay(base, overlays.get(service.code), order, "m", include_hidden)
                if applied:
                    tiles.append(applied)
                    order += 1

    # Инфо-плитка — если у отеля есть активные инфо-категории.
    info_category = (
        Category.objects.filter(type=OfferingType.INFO, is_active=True)
        .select_related("image")
        .order_by("sort_order", "code")
        .first()
    )
    if info_category is not None:
        info = {
            "key": "info",
            "type": "info",
            "title": translate(INFO_TITLE, language),
            "subtitle": None,
            "kind": None,
            "venue_count": None,
            "status": None,
            # Обложка берётся у инфо-раздела: плитка без фото среди
            # фотографических соседей читается как незагрузившаяся.
            "image": image_url(info_category.image, variant="card") or None,
            "cover_previews": [],
            "route": "/info",
            "enabled": True,
        }
        applied = _apply_overlay(info, overlays.get("info"), order, "s", include_hidden)
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
        applied = _apply_overlay(room, overlays.get("room-control"), order, "m", include_hidden)
        if applied:
            tiles.append(applied)
            order += 1

    tiles.sort(key=lambda entry: entry["order"])
    return tiles


def _venue_card(service: Service, language: str | None, moment: datetime | None) -> dict[str, Any]:
    return {
        "code": service.code,
        "title": translate(service.public_title, language) or service.code,
        "subtitle": translate(service.tagline, language) or None,
        "kind": service.execution_point.kind,
        "image": _service_image(service),
        "status": _service_status(service, moment),
        "route": f"/venue/{service.code}",
    }


def list_venues(
    hotel: Hotel, group: str, *, language: str | None = None, moment: datetime | None = None
) -> dict[str, Any]:
    """Уровень 2: карточки заведений одной группы (рестораны/спа/услуги)."""
    cards = [
        _venue_card(service, language, moment)
        for service in _venues(hotel)
        if SERVICE_TYPE_GROUP.get(service.type, "services") == group
    ]
    return {
        "group": group,
        "title": translate(GROUP_TITLES.get(group, {}), language) or group,
        "venues": cards,
    }
