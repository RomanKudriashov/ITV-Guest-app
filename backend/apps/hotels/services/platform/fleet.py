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
from apps.core.listing import sort_rows, text_key
from apps.hotels.services.platform import readiness
from apps.hotels.models import Hotel, HotelModule, OnPremNode, Room, Service

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
        # ЖИВЫЕ СТРОКИ (партия 62-A1). Здесь стоял `all_objects` без условия, и
        # мягко удалённое считалось вместе с живым: у «Кристалла» после e2e
        # реестр показывал 56133 номера вместо 9 и 521 сотрудника вместо 16.
        live = {"hotel_id__in": hotel_ids, "deleted_at__isnull": True}
        sources = [
            ("rooms", Room.all_objects.using("platform").filter(**live)),
            ("staff", User.all_objects.using("platform").filter(**live, is_staff_member=True)),
            ("items", Item.all_objects.using("platform").filter(**live)),
            ("services", Service.all_objects.using("platform").filter(**live)),
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
            .filter(hotel_id__in=hotel_ids, is_revoked=False, deleted_at__isnull=True)
            .values("hotel_id", "last_seen_at")
        )
        modules = (
            HotelModule.all_objects.using("platform")
            .filter(hotel_id__in=hotel_ids, is_enabled=True, deleted_at__isnull=True)
            .values_list("hotel_id", "code")
        )
        for hotel_id, code in modules:
            result[hotel_id].setdefault("modules", []).append(code)
    # Связь отеля — то же правило, что везде (`onprem.link_state`): хоть один
    # узел на связи — отель на связи. Лишний не подключавшийся узел рядом с
    # живым «не на связи» не делает (партия 62-F-хвост).
    threshold = timezone.now() - timedelta(seconds=OnPremNode.OFFLINE_AFTER_SECONDS)
    online: set = set()
    for row in nodes:
        entry = result[row["hotel_id"]]
        entry["has_node"] = True
        seen = row["last_seen_at"]
        if seen is not None and seen >= threshold:
            online.add(row["hotel_id"])
    for hotel_id, entry in result.items():
        if entry.get("has_node") and hotel_id not in online:
            entry["node_offline"] = True
    return result


def _status(hotel: Hotel) -> str:
    """Состояние строки во флоте. Тарифов и триала нет (партия 62-E1)."""
    return "active" if hotel.is_active else "disabled"


def _row(hotel: Hotel, counts: dict) -> dict:
    entry = counts.get(hotel.pk, {})
    return {
        "id": str(hotel.pk),
        "name": hotel.name_i18n,
        "subdomain": hotel.subdomain,
        "is_active": hotel.is_active,
        "origin": hotel.origin,
        "status": _status(hotel),
        "created_at": hotel.created_at.isoformat(),
        "counts": {
            "rooms": entry.get("rooms", 0),
            "staff": entry.get("staff", 0),
            "items": entry.get("items", 0),
            "services": entry.get("services", 0),
            "orders_7d": entry.get("orders_7d", 0),
        },
        "node_offline": bool(entry.get("node_offline")),
        "city": hotel.city_i18n or "",
        # Связь коннектора: на связи / молчит / коннектора нет.
        "link": "silent" if entry.get("node_offline") else "online" if entry.get("has_node") else "none",
        "modules": sorted(entry.get("modules", [])),
        # Проблемы — те же, что в обзоре карточки: сервер готовности, кэш 60 с.
        "problems": readiness.problem_count(hotel),
        # Самая тяжёлая проблема — для сортировки по важности (партия 62-F).
        "severity": _worst(hotel),
    }


def _worst(hotel: Hotel) -> str:
    if not hotel.is_active:
        return ""
    problems = readiness.readiness(hotel)["problems"]
    return problems[0]["severity"] if problems else ""


def _base_queryset(params: dict, user=None):
    """
    `user` нужен ради ОБЛАСТИ: администратор группы обязан не видеть чужие
    отели, а не видеть и не мочь их тронуть. Сам список чужих клиентов — уже
    утечка (см. `platform/scope.py`).
    """
    from apps.hotels.services.platform import scope

    queryset = scope.limit_queryset(user, Hotel.objects.all())

    # По умолчанию флот показывает ТОЛЬКО живые отели. Тестовые никуда не
    # деваются — их видно по явному запросу, иначе «чистый список» превращался
    # бы в «список, где что-то спрятано навсегда».
    origin = (params.get("origin") or "live").strip()
    if origin != "all":
        queryset = queryset.filter(origin=origin)

    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(_search_q(search))

    status = (params.get("status") or "").strip()
    if status == "active":
        queryset = queryset.filter(is_active=True)
    elif status == "disabled":
        queryset = queryset.filter(is_active=False)

    # ФИЛЬТР ПО ГРУППЕ — ТЕМ ЖЕ КОДОМ, что и адресация массового действия.
    # Несколько групп через запятую; `none` — отели без группы. Группы нет —
    # пустая выдача, а не «все отели»: молча показать всех на удалённой группе
    # значит предложить массовое действие не тем.
    group_param = [g for g in (params.get("group") or "").split(",") if g.strip()]
    if group_param:
        from apps.hotels.models import HotelGroupMember

        grouped = HotelGroupMember.objects.filter(group__deleted_at__isnull=True)
        condition = Q(pk__in=[])
        ids = [g for g in group_param if g != "none"]
        if ids:
            condition |= Q(pk__in=grouped.filter(group_id__in=_valid_uuids(ids)).values("hotel_id"))
        if "none" in group_param:
            condition |= ~Q(pk__in=grouped.values("hotel_id"))
        queryset = queryset.filter(condition)

    return queryset.order_by(SORTS.get((params.get("sort") or "name"), "name"))


def _valid_uuids(values: list[str]) -> list[str]:
    import uuid

    out = []
    for value in values:
        try:
            out.append(str(uuid.UUID(value)))
        except ValueError:
            continue
    return out


def _search_q(search: str) -> Q:
    """
    Поиск по названию, поддомену, ГОРОДУ и НАЗВАНИЮ ГРУППЫ (партия 62-A1).
    Город переводимый (JSON по языкам) — ищем по тексту всего значения.
    """
    from django.db.models import TextField
    from django.db.models.functions import Cast

    from apps.hotels.models import HotelGroupMember

    in_group = HotelGroupMember.objects.filter(
        group__deleted_at__isnull=True, group__title__icontains=search
    ).values("hotel_id")
    city = Hotel.objects.annotate(_city=Cast("city", TextField())).filter(_city__icontains=search).values("pk")
    return Q(name__icontains=search) | Q(subdomain__icontains=search) | Q(pk__in=city) | Q(pk__in=in_group)


VIEW_FACETS = ("state", "link", "module", "group")


def _state(row: dict) -> str:
    if not row["is_active"]:
        return "disabled"
    return "problems" if row["problems"] else "ready"


def _summary(rows: list[dict]) -> dict:
    active = [r for r in rows if r["is_active"]]
    return {
        "hotels": len(rows),
        "active": len(active),
        "rooms": sum(r["counts"]["rooms"] for r in rows),
        "problems": sum(r["problems"] for r in rows),
        "link": {
            "online": sum(1 for r in active if r["link"] == "online"),
            "silent": sum(1 for r in active if r["link"] == "silent"),
            "none": sum(1 for r in active if r["link"] == "none"),
        },
    }


# Столбцы «Отелей» и как их сравнивать. Состояние — по важности: мешает гостю
# → требует внимания → проверить → готов → отключён. Связь — не на связи →
# нет коннектора → на связи.
VIEW_SORTS = {
    "name": ("text", lambda r: r["name"]),
    "subdomain": ("text", lambda r: r["subdomain"]),
    "group": ("text", lambda r: r["group"]["title"] if r["group"] else None),
    "rooms": ("number", lambda r: r["counts"]["rooms"]),
    "modules": ("number", lambda r: len(r["modules"])),
    "link": ("rank", lambda r: r["link"], ("silent", "none", "online")),
    "state": (
        "rank",
        lambda r: "disabled" if not r["is_active"] else (r["severity"] or "ready"),
        ("bad", "warn", "info", "ready", "disabled"),
    ),
    "city": ("text", lambda r: r["city"] or None),
    "created": ("date", lambda r: r["created_at"]),
}


def fleet_view(params: dict, user=None) -> dict:
    """
    «Отели» нового вида (партия 62-A1): группы с их отелями и сводкой, ниже —
    «без группы»; или общим списком. Без страниц: реестр — десятки отелей, а
    сводка группы обязана считать всю группу, а не видимую страницу.

    Поиск — в базе (название, поддомен, город, название группы). Фильтры —
    поверх найденного, и счётчик у каждого значения фильтра считается при
    остальных выбранных фильтрах: «Связь · не на связи 2» противоречить
    видимому не может.
    """
    from apps.hotels.services.platform import groups as groups_svc

    layout = "list" if params.get("layout") == "list" else "groups"
    plain = {k: v for k, v in params.items() if k not in (*VIEW_FACETS, "search", "status", "page", "page_size")}
    hotels = list(_base_queryset(plain, user))
    search = (params.get("search") or "").strip()
    matched = (
        set(_base_queryset({**plain, "search": search}, user).values_list("pk", flat=True)) if search else None
    )
    counts = _batch_counts([hotel.pk for hotel in hotels])
    owners = groups_svc.group_by_hotel([hotel.pk for hotel in hotels])

    rows: list[dict] = []
    for hotel in hotels:
        row = _row(hotel, counts)
        group = owners.get(hotel.pk)
        row["group"] = {"id": str(group.pk), "title": group.title, "color": group.color} if group else None
        row["_match"] = matched is None or hotel.pk in matched
        rows.append(row)

    selected = {key: {v for v in (params.get(key) or "").split(",") if v} for key in VIEW_FACETS}
    # «Отключённые» старым параметром — то же, что состояние «отключён».
    if params.get("status") == "disabled":
        selected["state"].add("disabled")

    def value(row: dict, key: str) -> list[str]:
        if key == "state":
            return [_state(row)]
        if key == "link":
            return [row["link"]]
        if key == "module":
            return row["modules"]
        return [row["group"]["id"] if row["group"] else "none"]

    def passes(row: dict, skip: str | None = None) -> bool:
        if not row["_match"]:
            return False
        for key in VIEW_FACETS:
            if key != skip and selected[key] and not selected[key].intersection(value(row, key)):
                return False
        return True

    facets: dict[str, dict] = {}
    for key in VIEW_FACETS:
        bucket: dict[str, int] = {}
        for row in rows:
            if passes(row, skip=key):
                for v in value(row, key):
                    bucket[v] = bucket.get(v, 0) + 1
        facets[key] = bucket

    rank = {"problems": 0, "ready": 1, "disabled": 2}
    by_default = sorted((r for r in rows if passes(r)), key=lambda r: (rank[_state(r)], r["name"].lower()))
    # Столбец, который выбрал человек (партия 62-F); внутри каждой группы —
    # тот же порядок: группы делят уже отсортированный список.
    shown = sort_rows(by_default, params.get("sort"), params.get("dir"), VIEW_SORTS, then=lambda r: text_key(r["name"]))
    for row in rows:
        row.pop("_match", None)

    filtering = bool(search) or any(selected.values())
    groups_out = []
    for group in groups_svc.all_groups(user):
        mine = [r for r in rows if r["group"] and r["group"]["id"] == str(group.pk)]
        visible = [r for r in shown if r["group"] and r["group"]["id"] == str(group.pk)]
        if filtering and not visible:
            continue
        groups_out.append(
            {
                **groups_svc.serialize(group, with_size=False),
                "summary": _summary(mine),
                "items": visible,
            }
        )
    loose_all = [r for r in rows if not r["group"]]
    return {
        "layout": layout,
        "total": len(shown),
        "facets": facets,
        "groups": groups_out if layout == "groups" else [],
        "ungrouped": {"summary": _summary(loose_all), "items": [r for r in shown if not r["group"]]} if layout == "groups" else None,
        "items": shown if layout == "list" else [],
    }


def fleet(params: dict, user=None) -> dict:
    if params.get("layout") in ("groups", "list"):
        return fleet_view(params, user)
    queryset = _base_queryset(params, user)
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
        "facets": _facets(params, user),
    }


def _facets(params: dict, user=None) -> dict:
    scoped = dict(params)
    scoped.pop("status", None)
    queryset = _base_queryset(scoped, user)
    return {
        "all": queryset.count(),
        "active": queryset.filter(is_active=True).count(),
        "disabled": queryset.filter(is_active=False).count(),
    }


def export_csv(params: dict, user=None) -> str:
    """
    Выгрузка флота. Отдаём тот же срез, что видит человек на экране (с учётом
    поиска и фильтров), но БЕЗ пагинации: экспорт нужен как раз для того, чтобы
    вынести всё найденное целиком.
    """
    queryset = _base_queryset(params, user)
    hotels = list(queryset)
    counts = _batch_counts([hotel.pk for hotel in hotels])

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["name", "subdomain", "status",
         "rooms", "staff", "services", "items", "orders_7d", "created_at"]
    )
    for hotel in hotels:
        row = _row(hotel, counts)
        writer.writerow(
            [
                row["name"], row["subdomain"], row["status"],
                row["counts"]["rooms"], row["counts"]["staff"], row["counts"]["services"],
                row["counts"]["items"], row["counts"]["orders_7d"], row["created_at"],
            ]
        )
    return buffer.getvalue()


def bulk_targets(hotel_ids: list[str], is_active: bool) -> list[Hotel]:
    """
    Кому массовое действие ДЕЙСТВИТЕЛЬНО что-то меняет: аудит и отчёт
    «выключено N» считают смену состояния, а не количество нажатых галок.
    Само включение и отключение — `activation` (партия 62-C).
    """
    return list(Hotel.objects.filter(pk__in=hotel_ids).exclude(is_active=is_active))
