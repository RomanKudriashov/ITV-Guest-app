"""
Флот отелей: поиск, фильтры, сортировка, пагинация, массовые действия, экспорт.

Главное инженерное решение — счётчики берутся ПАКЕТОМ, а не по отелю.
Прежняя консоль на каждую строку списка делала три запроса в контексте тенанта:
на десятке демо-отелей это незаметно, на реальном флоте список превращается в
сотни запросов и становится самым дорогим экраном платформы. Здесь счётчики
считаются одним запросом на сущность через платформенное подключение
(BYPASSRLS) — оно и существует ровно для взгляда поверх тенантов.

Фильтр «без тестовых» опирается на признак ПРОИСХОЖДЕНИЯ отеля (`origin`), а не
на угадывание по имени или поддомену. Угадывание — это фильтр поверх мусора;
признак — правило, по которому мусор вообще отличим. Подробнее — в модели.
"""

from __future__ import annotations

import csv
import io
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.analytics.models import OrderDaily
from apps.catalog.models import Item
from apps.core.context import platform_scope
from apps.hotels.services import tariffs
from apps.hotels.models import Hotel, OnPremNode, Room, Service

ORDERS_WINDOW_DAYS = 7
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200

SORTS = {
    "name": "name",
    "-name": "-name",
    "created": "created_at",
    "-created": "-created_at",
    "subdomain": "subdomain",
    "-subdomain": "-subdomain",
}


def _batch_counts(hotel_ids: list) -> dict:
    """Счётчики по списку отелей — по одному запросу на сущность, не на отель."""
    if not hotel_ids:
        return {}
    result: dict = {hid: {"rooms": 0, "staff": 0, "items": 0, "services": 0, "orders_7d": 0} for hid in hotel_ids}
    since = timezone.localdate() - timedelta(days=ORDERS_WINDOW_DAYS - 1)

    with platform_scope():
        sources = [
            ("rooms", Room.all_objects.using("platform").filter(hotel_id__in=hotel_ids)),
            (
                "staff",
                User.all_objects.using("platform").filter(hotel_id__in=hotel_ids, is_staff_member=True),
            ),
            ("items", Item.all_objects.using("platform").filter(hotel_id__in=hotel_ids)),
            ("services", Service.all_objects.using("platform").filter(hotel_id__in=hotel_ids)),
        ]
        for key, queryset in sources:
            for row in queryset.values("hotel_id").annotate(n=Count("id")):
                result[row["hotel_id"]][key] = row["n"]

        orders = (
            OrderDaily.all_objects.using("platform")
            .filter(hotel_id__in=hotel_ids, business_date__gte=since)
            .values("hotel_id")
            .annotate(n=Sum("orders_count"))
        )
        for row in orders:
            result[row["hotel_id"]]["orders_7d"] = row["n"] or 0

        nodes = (
            OnPremNode.all_objects.using("platform")
            .filter(hotel_id__in=hotel_ids, is_revoked=False)
            .values("hotel_id", "last_seen_at")
        )
    threshold = timezone.now() - timedelta(seconds=OnPremNode.OFFLINE_AFTER_SECONDS)
    for row in nodes:
        entry = result[row["hotel_id"]]
        entry["has_node"] = True
        seen = row["last_seen_at"]
        if seen is None or seen < threshold:
            entry["node_offline"] = True
    return result


def _status(hotel: Hotel) -> str:
    """
    Состояние строки во флоте. Триал — не отдельный статус объекта, а следствие
    тарифа: отель на триале включён и работает, просто у него есть срок.
    """
    if not hotel.is_active:
        return "disabled"
    return "trial" if tariffs.get(hotel.tariff).is_trial else "active"


def _row(hotel: Hotel, counts: dict) -> dict:
    tariff = tariffs.get(hotel.tariff)
    entry = counts.get(hotel.pk, {})
    return {
        "id": str(hotel.pk),
        "name": hotel.name,
        "subdomain": hotel.subdomain,
        "is_active": hotel.is_active,
        "origin": hotel.origin,
        "status": _status(hotel),
        "tariff": tariff.code,
        "tariff_title": tariff.title,
        "trial_days_left": tariffs.trial_days_left(hotel),
        "created_at": hotel.created_at.isoformat(),
        "counts": {
            "rooms": entry.get("rooms", 0),
            "staff": entry.get("staff", 0),
            "items": entry.get("items", 0),
            "services": entry.get("services", 0),
            "orders_7d": entry.get("orders_7d", 0),
        },
        "node_offline": bool(entry.get("node_offline")),
    }


def _base_queryset(params: dict):
    queryset = Hotel.objects.all()

    # По умолчанию флот показывает ТОЛЬКО живые отели. Тестовые никуда не
    # деваются — их видно по явному запросу, иначе «чистый список» превращался
    # бы в «список, где что-то спрятано навсегда».
    origin = (params.get("origin") or "live").strip()
    if origin != "all":
        queryset = queryset.filter(origin=origin)

    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(Q(name__icontains=search) | Q(subdomain__icontains=search))

    status = (params.get("status") or "").strip()
    if status == "active":
        queryset = queryset.filter(is_active=True).exclude(tariff__in=_trial_codes())
    elif status == "trial":
        queryset = queryset.filter(is_active=True, tariff__in=_trial_codes())
    elif status == "disabled":
        queryset = queryset.filter(is_active=False)

    tariff = (params.get("tariff") or "").strip()
    if tariff:
        queryset = queryset.filter(tariff=tariff)

    return queryset.order_by(SORTS.get((params.get("sort") or "name"), "name"))


def _trial_codes() -> list[str]:
    return [code for code, tariff in tariffs.TARIFFS.items() if tariff.is_trial]


def fleet(params: dict) -> dict:
    queryset = _base_queryset(params)
    total = queryset.count()

    size = max(1, min(int(params.get("page_size") or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
    page = max(1, int(params.get("page") or 1))
    window = list(queryset[(page - 1) * size : page * size])
    counts = _batch_counts([hotel.pk for hotel in window])

    return {
        "items": [_row(hotel, counts) for hotel in window],
        "total": total,
        "page": page,
        "page_size": size,
        "pages": max(1, (total + size - 1) // size),
        # Счётчики вкладок-фильтров считаем поверх ТЕКУЩЕГО поиска, а не всего
        # флота — иначе «Активные · 15» противоречило бы найденным трём.
        "facets": _facets(params),
    }


def _facets(params: dict) -> dict:
    scoped = dict(params)
    scoped.pop("status", None)
    queryset = _base_queryset(scoped)
    trial = _trial_codes()
    return {
        "all": queryset.count(),
        "active": queryset.filter(is_active=True).exclude(tariff__in=trial).count(),
        "trial": queryset.filter(is_active=True, tariff__in=trial).count(),
        "disabled": queryset.filter(is_active=False).count(),
    }


def export_csv(params: dict) -> str:
    """
    Выгрузка флота. Отдаём тот же срез, что видит человек на экране (с учётом
    поиска и фильтров), но БЕЗ пагинации: экспорт нужен как раз для того, чтобы
    вынести всё найденное целиком.
    """
    queryset = _base_queryset(params)
    hotels = list(queryset)
    counts = _batch_counts([hotel.pk for hotel in hotels])

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["name", "subdomain", "status", "tariff", "trial_days_left",
         "rooms", "staff", "services", "items", "orders_7d", "created_at"]
    )
    for hotel in hotels:
        row = _row(hotel, counts)
        writer.writerow(
            [
                row["name"], row["subdomain"], row["status"], row["tariff"],
                row["trial_days_left"] if row["trial_days_left"] is not None else "",
                row["counts"]["rooms"], row["counts"]["staff"], row["counts"]["services"],
                row["counts"]["items"], row["counts"]["orders_7d"], row["created_at"],
            ]
        )
    return buffer.getvalue()


def bulk_set_active(hotel_ids: list[str], is_active: bool) -> list[Hotel]:
    """
    Массовое включение/отключение. Возвращает отели, которые ДЕЙСТВИТЕЛЬНО
    изменились: аудит и отчёт «выключено N» должны считать смену состояния, а
    не количество нажатых галок.
    """
    hotels = list(Hotel.objects.filter(pk__in=hotel_ids).exclude(is_active=is_active))
    if hotels:
        Hotel.objects.filter(pk__in=[hotel.pk for hotel in hotels]).update(
            is_active=is_active, updated_at=timezone.now()
        )
    return hotels
