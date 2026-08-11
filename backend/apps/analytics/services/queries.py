"""
Запросы дашборда: читают дневные роллапы (и справочники имён), живые заказы не
сканируют — кроме drill-down, который по определению показывает конкретные
заявки. Исключение одно: часовой разрез динамики читает журнал `AnalyticsEvent`,
потому что суточная строка роллапа часов не содержит; журнал при этом — не
второй источник правды, а тот же, из которого роллапы и пересчитываются.

Фильтры комбинируются (AND), период сравнивается с предыдущим той же длины,
сортировка — по любому столбцу таблицы. Группировки по времени — в сутках отеля.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Sum

from apps.core.errors import ValidationError
from apps.hotels.models import Hotel

from apps.analytics.models import (
    AnalyticsEvent,
    ItemDaily,
    ModifierDaily,
    OrderDaily,
    ReviewDaily,
    SessionDaily,
)
from apps.analytics.services.scope import Scope, scope_for

logger = logging.getLogger(__name__)


# --- Период ----------------------------------------------------------------


@dataclass(slots=True)
class Period:
    frm: date
    to: date

    @property
    def days(self) -> int:
        return (self.to - self.frm).days + 1


# Пресет → сколько суток назад от сегодняшнего дня отеля.
_PRESETS = {"today": 0, "week": 6, "month": 29}


def resolve_period(params: dict, hotel: Hotel) -> Period:
    preset = params.get("preset")
    today = hotel.local_now().date()
    if preset:
        if preset not in _PRESETS:
            raise ValidationError(
                f"Неизвестный период «{preset}». Ожидается один из: "
                + ", ".join(_PRESETS),
                field="preset",
                code="bad_preset",
            )
        return Period(today - timedelta(days=_PRESETS[preset]), today)

    frm = _parse_date(params.get("date_from"), field="date_from") or (today - timedelta(days=6))
    to = _parse_date(params.get("date_to"), field="date_to") or today
    if to < frm:
        # Молча менять границы местами нельзя: перепутанный диапазон — опечатка
        # клиента, а не намерение. Контракт для этой же ситуации уже требует
        # отказа (hotel-admin-api-contract.md: `from > to` — 422 bad_range).
        raise ValidationError(
            f"Начало периода ({frm.isoformat()}) позже конца ({to.isoformat()})",
            field="date_from",
            code="bad_range",
        )
    return Period(frm, to)


def previous_period(period: Period) -> Period:
    length = period.days
    prev_to = period.frm - timedelta(days=1)
    return Period(prev_to - timedelta(days=length - 1), prev_to)


def _parse_date(value, *, field: str) -> date | None:
    """
    Пусто — параметр не прислали, подставится значение по умолчанию.

    Мусор — ошибка запроса, а не повод взять другой период. Молчаливая подмена
    отдавала 200 с цифрами за НЕ ТЕ сутки, и заметить это можно было только
    сверив эхо периода в ответе — то есть почти никогда.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError(
            f"Некорректная дата: «{value}». Ожидается ГГГГ-ММ-ДД",
            field=field,
            code="bad_date",
        ) from None


# --- Применение скоупа и фильтров ------------------------------------------

# query-параметр → колонка агрегата (уровень заказа).
_ORDER_FILTERS = {
    "type": "offering_type",
    "point_id": "point_key",
    "location_id": "location_key",
    "entry_method": "entry_method",
    "device": "device",
    "language": "language",
}


def _apply_scope_points(qs, scope: Scope, column: str = "point_key"):
    if not scope.all_points:
        qs = qs.filter(**{f"{column}__in": scope.point_ids or ["__none__"]})
    return qs


def _order_qs(scope: Scope, params: dict, period: Period):
    qs = OrderDaily.objects.filter(business_date__gte=period.frm, business_date__lte=period.to)
    qs = _apply_scope_points(qs, scope)
    for key, column in _ORDER_FILTERS.items():
        value = params.get(key)
        if value:
            qs = qs.filter(**{column: value})
    return qs


def _item_qs(scope: Scope, params: dict, period: Period):
    qs = ItemDaily.objects.filter(business_date__gte=period.frm, business_date__lte=period.to)
    qs = _apply_scope_points(qs, scope)
    if params.get("type"):
        qs = qs.filter(offering_type=params["type"])
    if params.get("category_id"):
        qs = qs.filter(category_key=params["category_id"])
    if params.get("item_id"):
        qs = qs.filter(item_key=params["item_id"])
    if params.get("point_id"):
        qs = qs.filter(point_key=params["point_id"])
    return qs


def _review_qs(scope: Scope, params: dict, period: Period):
    qs = ReviewDaily.objects.filter(business_date__gte=period.frm, business_date__lte=period.to)
    qs = _apply_scope_points(qs, scope)
    if params.get("type"):
        qs = qs.filter(offering_type=params["type"])
    if params.get("point_id"):
        qs = qs.filter(point_key=params["point_id"])
    return qs


def _session_qs(params: dict, period: Period):
    qs = SessionDaily.objects.filter(business_date__gte=period.frm, business_date__lte=period.to)
    for key in ("entry_method", "device", "language"):
        if params.get(key):
            qs = qs.filter(**{key: params[key]})
    return qs


# --- Сводка ----------------------------------------------------------------


def _order_totals(qs) -> dict:
    agg = qs.aggregate(
        orders=Sum("orders_count"),
        revenue=Sum("revenue_minor"),
        service_fee=Sum("service_fee_minor"),
        delivery=Sum("delivery_minor"),
        tax=Sum("tax_minor"),
        tip=Sum("tip_minor"),
        items=Sum("items_count"),
        cancelled=Sum("cancelled_count"),
        completed=Sum("completed_count"),
        off_hours=Sum("off_hours_count"),
        reaction_sum=Sum("reaction_seconds_sum"),
        reaction_n=Sum("reaction_count"),
        fulfil_sum=Sum("fulfil_seconds_sum"),
        fulfil_n=Sum("fulfil_count"),
    )
    return {k: (v or 0) for k, v in agg.items()}


def _summary_block(scope: Scope, params: dict, period: Period) -> dict:
    o = _order_totals(_order_qs(scope, params, period))
    r = _review_qs(scope, params, period).aggregate(
        reviews=Sum("reviews_count"), rating=Sum("rating_sum"), low=Sum("low_count")
    )
    reviews = r["reviews"] or 0

    block = {
        "orders": o["orders"],
        "revenue_minor": o["revenue"],
        # Разложение выручки: позиции отдельно от начислений.
        "service_fee_minor": o["service_fee"],
        "delivery_minor": o["delivery"],
        "tax_minor": o["tax"],
        "tip_minor": o["tip"],
        "gross_minor": o["revenue"] + o["service_fee"] + o["delivery"] + o["tax"] + o["tip"],
        "items_count": o["items"],
        "cancelled": o["cancelled"],
        "completed": o["completed"],
        "off_hours": o["off_hours"],
        "avg_check_minor": _ratio(o["revenue"], o["orders"], as_int=True),
        "items_per_order": _ratio(o["items"], o["orders"]),
        "completed_rate": _ratio(o["completed"], o["orders"]),
        "cancel_rate": _ratio(o["cancelled"], o["orders"]),
        "avg_reaction_seconds": _ratio(o["reaction_sum"], o["reaction_n"], as_int=True),
        "avg_fulfil_seconds": _ratio(o["fulfil_sum"], o["fulfil_n"], as_int=True),
        "reviews": reviews,
        "avg_rating": _ratio(r["rating"] or 0, reviews),
        "low_review_rate": _ratio(r["low"] or 0, reviews),
    }

    # Трафик/конверсия — только когда виден весь отель: сессия не привязана к точке.
    if scope.all_points:
        s = _session_qs(params, period).aggregate(
            sessions=Sum("sessions_count"), converted=Sum("converted_count")
        )
        sessions = s["sessions"] or 0
        block["sessions"] = sessions
        block["conversion"] = _ratio(s["converted"] or 0, sessions)
    else:
        block["sessions"] = None
        block["conversion"] = None
    return block


def summary(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    current = _summary_block(scope, params, period)
    result = {
        "period": {"from": period.frm.isoformat(), "to": period.to.isoformat(), "tz": hotel.timezone},
        "current": current,
    }
    if params.get("compare") == "previous":
        prev = previous_period(period)
        previous = _summary_block(scope, params, prev)
        result["previous"] = previous
        result["previous_period"] = {"from": prev.frm.isoformat(), "to": prev.to.isoformat()}
        result["delta"] = {
            key: _delta(current.get(key), previous.get(key))
            for key in ("orders", "revenue_minor", "avg_check_minor", "avg_rating", "sessions", "conversion")
        }
    return result


# --- Динамика --------------------------------------------------------------


# Разрезы времени. `hour` считается не из дневных роллапов, а из журнала
# событий — см. _hourly_points.
_GRANULARITIES = ("hour", "day", "week")

# Потолок для часового разреза. Часы читаются построчно из журнала, и год в
# часах — это 8760 столбиков, то есть не график. Месячный пресет (30 суток)
# помещается целиком.
HOURLY_MAX_DAYS = 31


def _resolve_granularity(params: dict, period: Period) -> str:
    granularity = params.get("granularity") or "day"
    if granularity not in _GRANULARITIES:
        raise ValidationError(
            f"Неизвестная гранулярность «{granularity}». Ожидается одна из: "
            + ", ".join(_GRANULARITIES),
            field="granularity",
            code="bad_granularity",
        )
    if granularity == "hour" and period.days > HOURLY_MAX_DAYS:
        raise ValidationError(
            f"Почасовой разрез — не больше {HOURLY_MAX_DAYS} суток за раз, "
            f"запрошено {period.days}. Возьмите период короче или разрез day/week",
            field="granularity",
            code="range_too_large",
        )
    return granularity


def timeseries(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    granularity = _resolve_granularity(params, period)
    if granularity == "hour":
        return {"granularity": "hour", "points": _hourly_points(scope, params, period, hotel)}

    qs = _order_qs(scope, params, period).values("business_date").annotate(
        orders=Sum("orders_count"), revenue=Sum("revenue_minor"),
        cancelled=Sum("cancelled_count"), completed=Sum("completed_count"),
    )
    by_day = {row["business_date"]: row for row in qs}

    points = []
    for bucket, days in _buckets(period, granularity):
        orders = sum((by_day.get(d, {}).get("orders") or 0) for d in days)
        revenue = sum((by_day.get(d, {}).get("revenue") or 0) for d in days)
        cancelled = sum((by_day.get(d, {}).get("cancelled") or 0) for d in days)
        completed = sum((by_day.get(d, {}).get("completed") or 0) for d in days)
        points.append({
            "bucket": bucket,
            "orders": orders, "revenue_minor": revenue,
            "cancelled": cancelled, "completed": completed,
        })
    return {"granularity": granularity, "points": points}


def _buckets(period: Period, granularity: str):
    days = [period.frm + timedelta(days=i) for i in range(period.days)]
    if granularity == "week":
        groups: dict[str, list] = {}
        for d in days:
            key = (d - timedelta(days=d.weekday())).isoformat()
            groups.setdefault(key, []).append(d)
        return [(k, v) for k, v in sorted(groups.items())]
    # День — базовая гранулярность агрегатов.
    return [(d.isoformat(), [d]) for d in days]


# --- Часовой разрез --------------------------------------------------------
#
# Дневные роллапы часов не содержат и содержать не могут: строка `OrderDaily` —
# это сутки. Поэтому часы считаются из `AnalyticsEvent` — того же журнала, из
# которого идёт пересчёт роллапов. Второго источника правды не появляется.


def _event_qs(scope: Scope, params: dict, period: Period, kinds: tuple[str, ...]):
    """Журнал за период с теми же скоупом и фильтрами, что и дневные запросы."""
    qs = AnalyticsEvent.objects.filter(
        business_date__gte=period.frm, business_date__lte=period.to, kind__in=kinds
    )
    if not scope.all_points:
        qs = qs.filter(dimensions__point_key__in=scope.point_ids or ["__none__"])
    for key, column in _ORDER_FILTERS.items():
        value = params.get(key)
        if value:
            qs = qs.filter(**{f"dimensions__{column}": value})
    return qs


def _local_hour(hotel: Hotel, moment) -> str:
    """Час в поясе отеля, без пояса в строке: «2026-07-20T14:00»."""
    return hotel.to_local(moment).strftime("%Y-%m-%dT%H:00")


def _hour_keys(period: Period) -> list[str]:
    return [
        f"{(period.frm + timedelta(days=day)).isoformat()}T{hour:02d}:00"
        for day in range(period.days)
        for hour in range(24)
    ]


def _hourly_points(scope: Scope, params: dict, period: Period, hotel: Hotel) -> list[dict]:
    """
    Динамика по часам суток отеля.

    Час заказа — час его СОЗДАНИЯ, а не час события. Так же устроены сутки:
    `OrderDaily` относит все меры к дате создания, поэтому заказ, сделанный в
    23:50 и завершённый в 00:10, целиком лежит в одном дне. Считай мы завершение
    по времени завершения, часы перестали бы складываться в сутки — а два
    разреза одного дашборда, дающие разные итоги, хуже отсутствия одного из них.
    """
    events = list(
        _event_qs(scope, params, period, ("order_created", "order_completed", "order_cancelled"))
        .values("kind", "occurred_at", "order_id", "measures")
    )
    created_hour = {
        event["order_id"]: _local_hour(hotel, event["occurred_at"])
        for event in events
        if event["kind"] == "order_created"
    }

    buckets = {
        key: {"orders": 0, "revenue_minor": 0, "cancelled": 0, "completed": 0}
        for key in _hour_keys(period)
    }
    orphans = 0
    for event in events:
        hour = created_hour.get(event["order_id"])
        if hour is None:
            # Завершение без создания в журнале — тот всегда пишется первым,
            # так что это порча журнала, а не штатный случай. Час такому факту
            # взять неоткуда; относим к началу его суток, чтобы часы всё равно
            # сходились с днём, и жалуемся в журнал.
            hour = f"{event['occurred_at'].date().isoformat()}T00:00"
            orphans += 1
        bucket = buckets.get(hour)
        if bucket is None:
            continue
        if event["kind"] == "order_created":
            bucket["orders"] += 1
            bucket["revenue_minor"] += int((event["measures"] or {}).get("revenue_minor", 0))
        elif event["kind"] == "order_completed":
            bucket["completed"] += 1
        else:
            bucket["cancelled"] += 1

    if orphans:
        logger.warning(
            "часовой разрез: %s фактов без события создания — журнал неполон", orphans
        )
    return [{"bucket": key, **values} for key, values in sorted(buckets.items())]


# --- Разбивка --------------------------------------------------------------

_ORDER_DIMENSIONS = {"type": "offering_type", "point": "point_key", "location": "location_key",
                     "entry_method": "entry_method", "device": "device", "language": "language"}


def breakdown(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    dimension = params.get("dimension", "type")

    if dimension in ("item", "category"):
        rows = _breakdown_items(scope, params, period, dimension)
    elif dimension == "modifier":
        rows = _breakdown_modifiers(scope, params, period)
    elif dimension in _ORDER_DIMENSIONS:
        rows = _breakdown_orders(scope, params, period, dimension)
    else:
        rows = _breakdown_orders(scope, params, period, "type")
        dimension = "type"

    rows = _resolve_labels(dimension, rows)
    total = sum(r.get("revenue_minor", r.get("orders", 0)) or 0 for r in rows) or 1
    for r in rows:
        base = r.get("revenue_minor", r.get("orders", 0)) or 0
        r["share"] = round(base / total, 4)

    rows = _sort_rows(rows, params)
    return {"dimension": dimension, "rows": rows}


def _breakdown_orders(scope, params, period, dimension) -> list[dict]:
    column = _ORDER_DIMENSIONS[dimension]
    qs = _order_qs(scope, params, period).values(column).annotate(
        orders=Sum("orders_count"), revenue_minor=Sum("revenue_minor"),
        items=Sum("items_count"), cancelled=Sum("cancelled_count"),
        completed=Sum("completed_count"),
    )
    return [{"key": row[column] or "", **{k: (row[k] or 0) for k in ("orders", "revenue_minor", "items", "cancelled", "completed")}} for row in qs]


def _breakdown_items(scope, params, period, dimension) -> list[dict]:
    column = "item_key" if dimension == "item" else "category_key"
    qs = _item_qs(scope, params, period).values(column).annotate(
        quantity=Sum("quantity"), revenue_minor=Sum("revenue_minor"), orders=Sum("orders_count"),
    )
    return [{"key": row[column] or "", **{k: (row[k] or 0) for k in ("quantity", "revenue_minor", "orders")}} for row in qs]


def _breakdown_modifiers(scope, params, period) -> list[dict]:
    qs = ModifierDaily.objects.filter(business_date__gte=period.frm, business_date__lte=period.to)
    qs = _apply_scope_points(qs, scope)
    if params.get("point_id"):
        qs = qs.filter(point_key=params["point_id"])
    qs = qs.values("modifier_key").annotate(quantity=Sum("quantity"))
    return [{"key": row["modifier_key"], "quantity": row["quantity"] or 0} for row in qs]


# --- Операции --------------------------------------------------------------


def operations(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)

    # Загрузка и время — по отделам.
    by_point = _order_qs(scope, params, period).values("point_key").annotate(
        orders=Sum("orders_count"), completed=Sum("completed_count"), cancelled=Sum("cancelled_count"),
        reaction_sum=Sum("reaction_seconds_sum"), reaction_n=Sum("reaction_count"),
        fulfil_sum=Sum("fulfil_seconds_sum"), fulfil_n=Sum("fulfil_count"),
    )
    rows = []
    for row in by_point:
        rows.append({
            "key": row["point_key"] or "",
            "orders": row["orders"] or 0,
            "completed": row["completed"] or 0,
            "cancelled": row["cancelled"] or 0,
            "avg_reaction_seconds": _ratio(row["reaction_sum"] or 0, row["reaction_n"] or 0, as_int=True),
            "avg_fulfil_seconds": _ratio(row["fulfil_sum"] or 0, row["fulfil_n"] or 0, as_int=True),
        })
    rows = _resolve_labels("point", rows)
    rows = _sort_rows(rows, params, default="orders")

    return {
        "by_point": rows,
        "escalations": _escalation_counts(scope, period),
    }


def _escalation_counts(scope: Scope, period: Period) -> dict:
    """Срабатывания эскалации — из уже персистентного журнала уведомлений."""
    from apps.notifications.models import NotificationLog
    from apps.orders.models import Order

    qs = NotificationLog.objects.filter(
        parent__isnull=True, status="sent",
        created_at__date__gte=period.frm, created_at__date__lte=period.to,
    )
    if not scope.all_points:
        order_ids = Order.objects.filter(execution_point_id__in=scope.point_ids or []).values_list("pk", flat=True)
        qs = qs.filter(order_id__in=list(order_ids))
    return {"fired": qs.count()}


# --- Трафик ----------------------------------------------------------------


def traffic(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    if not scope.all_points:
        # Сессии не привязаны к точке — трафик виден только на уровне отеля.
        return {"available": False, "by_entry": [], "by_device": [], "by_language": [], "totals": {}}

    qs = _session_qs(params, period)
    totals = qs.aggregate(sessions=Sum("sessions_count"), converted=Sum("converted_count"))
    sessions = totals["sessions"] or 0

    def group(column):
        rows = qs.values(column).annotate(sessions=Sum("sessions_count"), converted=Sum("converted_count"))
        return [{"key": row[column] or "", "sessions": row["sessions"] or 0,
                 "converted": row["converted"] or 0,
                 "conversion": _ratio(row["converted"] or 0, row["sessions"] or 0)} for row in rows]

    return {
        "available": True,
        "totals": {"sessions": sessions, "converted": totals["converted"] or 0,
                   "conversion": _ratio(totals["converted"] or 0, sessions)},
        "by_entry": group("entry_method"),
        "by_device": group("device"),
        "by_language": group("language"),
    }


# --- Отзывы ----------------------------------------------------------------


def reviews(hotel: Hotel, user, params: dict) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    qs = _review_qs(scope, params, period)
    totals = qs.aggregate(reviews=Sum("reviews_count"), rating=Sum("rating_sum"), low=Sum("low_count"))
    reviews_n = totals["reviews"] or 0

    by_day = qs.values("business_date").annotate(
        reviews=Sum("reviews_count"), rating=Sum("rating_sum"), low=Sum("low_count")
    ).order_by("business_date")
    trend = [{"bucket": row["business_date"].isoformat(),
              "reviews": row["reviews"] or 0,
              "avg_rating": _ratio(row["rating"] or 0, row["reviews"] or 0),
              "low": row["low"] or 0} for row in by_day]

    return {
        "totals": {"reviews": reviews_n,
                   "avg_rating": _ratio(totals["rating"] or 0, reviews_n),
                   "low": totals["low"] or 0,
                   "low_rate": _ratio(totals["low"] or 0, reviews_n)},
        "trend": trend,
    }


# --- Drill-down (живые заявки) ---------------------------------------------


def drilldown(hotel: Hotel, user, params: dict, *, limit: int = 200) -> dict:
    scope = scope_for(user)
    period = resolve_period(params, hotel)
    from apps.orders.models import Order

    # children (исполнение фанного заказа) в ленту не идут — единица гостевого
    # заказа это parent-агрегат (несёт деньги); иначе двойной счёт и дубли строк.
    qs = (
        Order.objects.filter(parent__isnull=True)
        .select_related("status", "execution_point", "room", "review")
        .order_by("-created_at")
    )

    # Диапазон дат — в сутках отеля: границы дня переводим в аварные моменты.
    qs = qs.filter(
        created_at__gte=_aware(period.frm, hotel, end=False),
        created_at__lte=_aware(period.to, hotel, end=True),
    )

    if not scope.all_points:
        qs = qs.filter(execution_point_id__in=scope.point_ids or [])
    if params.get("point_id"):
        qs = qs.filter(execution_point_id=params["point_id"])
    if params.get("location_id"):
        qs = qs.filter(location_id=params["location_id"])
    if params.get("status"):
        qs = qs.filter(status__code=params["status"])
    if params.get("room"):
        qs = qs.filter(room__number=params["room"])
    if params.get("floor"):
        qs = qs.filter(room__floor=params["floor"])
    if params.get("item_id"):
        qs = qs.filter(items__item_id=params["item_id"]).distinct()
    if params.get("type"):
        qs = qs.filter(items__item__category__type=params["type"]).distinct()

    total = qs.count()
    orders = []
    for order in qs[:limit]:
        review = getattr(order, "review", None)
        orders.append({
            "id": str(order.pk),
            "number": order.number,
            "point": order.execution_point.title_i18n or order.execution_point.code if order.execution_point_id else "",
            "status": order.status.code,
            "status_title": order.status.title_i18n,
            "total_minor": order.total,
            "created_at": order.created_at.isoformat(),
            "room": order.room.number if order.room_id else "",
            "rating": review.rating if review else None,
        })
    return {"orders": orders, "total": total}


def _aware(day: date, hotel: Hotel, *, end: bool):
    from datetime import datetime, time

    moment = datetime.combine(day, time.max if end else time.min)
    return moment.replace(tzinfo=hotel.tzinfo)


# --- Общие помощники -------------------------------------------------------


def _ratio(numerator, denominator, *, as_int: bool = False):
    if not denominator:
        return 0
    value = numerator / denominator
    return int(round(value)) if as_int else round(value, 4)


def _delta(current, previous):
    if current is None or previous is None:
        return None
    if not previous:
        return None
    return round((current - previous) / previous, 4)


def _sort_rows(rows: list[dict], params: dict, *, default: str | None = None) -> list[dict]:
    sort = params.get("sort") or default
    if not sort or not rows:
        # По умолчанию — по убыванию выручки/количества.
        default_key = "revenue_minor" if "revenue_minor" in rows[0] else ("quantity" if "quantity" in rows[0] else "orders")
        return sorted(rows, key=lambda r: r.get(default_key, 0) or 0, reverse=True)
    reverse = params.get("order", "desc") != "asc"
    return sorted(rows, key=lambda r: (r.get(sort) is None, r.get(sort, 0) if not isinstance(r.get(sort), str) else r.get(sort, "")), reverse=reverse)


# --- Разрешение имён измерений ---------------------------------------------


def _resolve_labels(dimension: str, rows: list[dict]) -> list[dict]:
    keys = [r["key"] for r in rows if r.get("key")]
    labels: dict[str, str] = {}

    if dimension == "point":
        from apps.hotels.models import ExecutionPoint

        for p in ExecutionPoint.all_objects.filter(pk__in=keys):
            labels[str(p.pk)] = p.title_i18n or p.code
    elif dimension == "location":
        from apps.hotels.models import Location

        for loc in Location.all_objects.filter(pk__in=keys):
            labels[str(loc.pk)] = loc.title_i18n or loc.code
    elif dimension == "item":
        from apps.catalog.models import Item

        for it in Item.all_objects.filter(pk__in=keys):
            labels[str(it.pk)] = it.title_i18n or it.code
    elif dimension == "category":
        from apps.catalog.models import Category

        for c in Category.all_objects.filter(pk__in=keys):
            labels[str(c.pk)] = c.title_i18n or c.code

    for r in rows:
        r["label"] = labels.get(r.get("key", ""), r.get("key", "") or "—")
    return rows
