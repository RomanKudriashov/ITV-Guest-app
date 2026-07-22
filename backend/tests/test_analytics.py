"""
Аналитика: сбор через события, идемпотентность, пересчёт == живая агрегация,
скоуп прав, изоляция тенантов, фильтры/сортировка/сравнение, экспорт.

Тесты самодостаточны по времени (TZ-проверка не зависит от «сегодня»).
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone as dt_timezone

import pytest

from apps.analytics import collector, queries
from apps.analytics.export import create_export, execute_export, render_csv
from apps.analytics.models import (
    ItemDaily,
    OrderDaily,
    ReviewDaily,
    SessionDaily,
)
from apps.analytics.recompute import recompute_aggregates
from apps.analytics.scope import scope_for
from apps.core.context import tenant_context

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


def _item_id(code="caesar"):
    from apps.catalog.models import Item

    return str(Item.objects.get(code=code).pk)


def _point_id(code):
    from apps.hotels.models import ExecutionPoint

    return str(ExecutionPoint.objects.get(code=code).pk)


def _session(room="201", language="ru", ua="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile"):
    from apps.accounts.services import create_guest_session

    return create_guest_session(room_number=room, language=language, user_agent=ua).session


def _admin(hotel):
    from apps.accounts.models import User

    return User.objects.create_user(
        email="admin@crystal.local", password="x", hotel=hotel,
        is_hotel_admin=True, is_staff_member=True,
    )


def _feed(hotel, kind, bd, dims, measures, key):
    collector.record(
        hotel.pk,
        {
            "dedupe_key": key,
            "kind": kind,
            "name": kind,
            "occurred_at": datetime(2026, 7, 20, 12, 0, tzinfo=dt_timezone.utc),
            "business_date": bd,
            "dimensions": dims,
            "measures": measures,
        },
    )


# --- Сбор через события (сквозной) -----------------------------------------


def test_order_lifecycle_populates_aggregates(crystal, django_capture_on_commit_callbacks):
    from apps.accounts.models import User
    from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order, get_order
    from apps.orders.tracker import accept_order

    with tenant_context(crystal):
        chef = User.objects.get(email="chef@crystal.local")
        with django_capture_on_commit_callbacks(execute=True):
            session = _session()
            order = create_order(
                OrderInput(lines=[OrderLineInput(item_id=_item_id(), quantity=2)], room_id=None),
                guest_session=session,
            )
            accept_order(chef, order.pk)
            change_status(get_order(order.pk), to_code="done", actor_type="staff", actor_id=chef.pk)

        od = list(OrderDaily.objects.all())
        assert sum(r.orders_count for r in od) == 1
        assert sum(r.items_count for r in od) == 2
        assert sum(r.completed_count for r in od) == 1
        assert sum(r.reaction_count for r in od) == 1
        assert sum(r.fulfil_count for r in od) == 1
        # Позиция и сессия тоже посчитаны.
        assert sum(r.quantity for r in ItemDaily.objects.all()) == 2
        s = SessionDaily.objects.all()
        assert sum(r.sessions_count for r in s) == 1
        assert sum(r.converted_count for r in s) == 1


def test_review_event_populates_review_daily(crystal, django_capture_on_commit_callbacks):
    from apps.accounts.models import User
    from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order, get_order
    from apps.reviews.services import create_review

    with tenant_context(crystal):
        chef = User.objects.get(email="chef@crystal.local")
        with django_capture_on_commit_callbacks(execute=True):
            session = _session()
            order = create_order(
                OrderInput(lines=[OrderLineInput(item_id=_item_id())], room_id=None),
                guest_session=session,
            )
            change_status(get_order(order.pk), to_code="done", actor_type="staff", actor_id=chef.pk)
            create_review(get_order(order.pk), guest_session=session, rating=2, comment="холодно")

        rd = list(ReviewDaily.objects.all())
        assert sum(r.reviews_count for r in rd) == 1
        assert sum(r.rating_sum for r in rd) == 2
        assert sum(r.low_count for r in rd) == 1  # 2 ≤ порог 3


# --- Идемпотентность -------------------------------------------------------


def test_repeat_event_does_not_double_count(crystal):
    with tenant_context(crystal):
        raw = {
            "dedupe_key": "order_created:test-1",
            "kind": "order_created",
            "name": "order.created",
            "occurred_at": datetime(2026, 7, 20, 9, 0, tzinfo=dt_timezone.utc),
            "business_date": date(2026, 7, 20),
            "dimensions": {"offering_type": "product", "point_key": "k"},
            "measures": {"revenue_minor": 1000, "items_count": 1},
        }
        assert collector.record(crystal.pk, raw) is True
        assert collector.record(crystal.pk, raw) is False  # повтор — no-op
        assert collector.record(crystal.pk, raw) is False

        row = OrderDaily.objects.get(offering_type="product", point_key="k")
        assert row.orders_count == 1
        assert row.revenue_minor == 1000


# --- Пересчёт == живая агрегация -------------------------------------------


def test_recompute_matches_online(crystal, django_capture_on_commit_callbacks):
    from apps.accounts.models import User
    from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order, get_order
    from apps.orders.tracker import accept_order

    with tenant_context(crystal):
        chef = User.objects.get(email="chef@crystal.local")
        with django_capture_on_commit_callbacks(execute=True):
            for i in range(3):
                session = _session(room="201")
                order = create_order(
                    OrderInput(lines=[OrderLineInput(item_id=_item_id(), quantity=i + 1)], room_id=None),
                    guest_session=session,
                )
                accept_order(chef, order.pk)
                change_status(get_order(order.pk), to_code="done", actor_type="staff", actor_id=chef.pk)

        online = _snapshot()
        assert online  # не пусто
        recompute_aggregates(crystal.pk)
        replayed = _snapshot()
        assert replayed == online


def _snapshot() -> dict:
    """Слепок всех роллапов для сравнения живой агрегации и пересчёта."""
    snap = {}
    for model in (OrderDaily, ItemDaily, ReviewDaily, SessionDaily):
        rows = []
        for r in model.objects.all():
            data = {
                f.name: getattr(r, f.name)
                for f in model._meta.fields
                if f.name not in ("id", "created_at", "updated_at", "deleted_at", "hotel")
            }
            rows.append(tuple(sorted((k, str(v)) for k, v in data.items())))
        snap[model.__name__] = sorted(rows)
    return snap


# --- Часовой пояс отеля ----------------------------------------------------


def test_business_date_uses_hotel_timezone(crystal):
    from apps.analytics.dimensions import business_date_for

    # 22:30 UTC 20-го июля в Москве (+3) — это уже 21-е июля по времени отеля.
    moment = datetime(2026, 7, 20, 22, 30, tzinfo=dt_timezone.utc)
    assert crystal.timezone == "Europe/Moscow"
    assert business_date_for(crystal, moment) == date(2026, 7, 21)


# --- Скоуп прав ------------------------------------------------------------


def test_point_senior_sees_only_their_point(crystal):
    with tenant_context(crystal):
        from apps.accounts.models import User

        chef = User.objects.get(email="chef@crystal.local")  # LEAD кухни
        admin = _admin(crystal)
        kitchen, concierge = _point_id("kitchen"), _point_id("concierge")

        _feed(crystal, "order_created", date(2026, 7, 20),
              {"offering_type": "product", "point_key": kitchen}, {"revenue_minor": 500, "items_count": 1}, "k1")
        _feed(crystal, "order_created", date(2026, 7, 20),
              {"offering_type": "service_request", "point_key": concierge}, {"revenue_minor": 0, "items_count": 1}, "c1")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20"}
        assert queries.summary(crystal, chef, params)["current"]["orders"] == 1  # только кухня
        assert queries.summary(crystal, admin, params)["current"]["orders"] == 2  # весь отель

        # Трафик недоступен старшему точки (сессия не привязана к точке).
        assert queries.traffic(crystal, chef, params)["available"] is False
        assert scope_for(chef).all_points is False
        assert scope_for(admin).all_points is True


# --- Изоляция тенантов -----------------------------------------------------


def test_tenant_isolation(crystal, aurora):
    _feed(crystal, "order_created", date(2026, 7, 20),
          {"offering_type": "product", "point_key": "k"}, {"revenue_minor": 999, "items_count": 1}, "iso-1")

    with tenant_context(crystal):
        assert OrderDaily.objects.count() == 1
    # Отель B не видит строк отеля A.
    with tenant_context(aurora):
        assert OrderDaily.objects.count() == 0


# --- Фильтры / сортировка / сравнение --------------------------------------


def test_filters_combine(crystal):
    with tenant_context(crystal):
        admin = _admin(crystal)
        bd = date(2026, 7, 20)
        _feed(crystal, "order_created", bd, {"offering_type": "product", "point_key": "k", "device": "mobile"},
              {"revenue_minor": 100, "items_count": 1}, "f1")
        _feed(crystal, "order_created", bd, {"offering_type": "slot", "point_key": "k", "device": "desktop"},
              {"revenue_minor": 200, "items_count": 1}, "f2")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20"}
        assert queries.summary(crystal, admin, params)["current"]["orders"] == 2
        # Комбинация фильтров (AND): тип + устройство.
        narrow = {**params, "type": "product", "device": "mobile"}
        assert queries.summary(crystal, admin, narrow)["current"]["orders"] == 1
        empty = {**params, "type": "product", "device": "desktop"}
        assert queries.summary(crystal, admin, empty)["current"]["orders"] == 0


def test_breakdown_sorts_by_column(crystal):
    with tenant_context(crystal):
        admin = _admin(crystal)
        bd = date(2026, 7, 20)
        _feed(crystal, "order_created", bd, {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 100, "items_count": 1}, "b1")
        _feed(crystal, "order_created", bd, {"offering_type": "slot", "point_key": "k"},
              {"revenue_minor": 900, "items_count": 1}, "b2")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20", "dimension": "type",
                  "sort": "revenue_minor", "order": "desc"}
        rows = queries.breakdown(crystal, admin, params)["rows"]
        assert [r["key"] for r in rows] == ["slot", "product"]
        params["order"] = "asc"
        rows = queries.breakdown(crystal, admin, params)["rows"]
        assert [r["key"] for r in rows] == ["product", "slot"]


def test_compare_previous_period(crystal):
    with tenant_context(crystal):
        admin = _admin(crystal)
        _feed(crystal, "order_created", date(2026, 7, 20), {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 300, "items_count": 1}, "cur")
        _feed(crystal, "order_created", date(2026, 7, 19), {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 100, "items_count": 1}, "prev")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20", "compare": "previous"}
        result = queries.summary(crystal, admin, params)
        assert result["current"]["orders"] == 1
        assert result["previous"]["orders"] == 1
        assert result["previous_period"] == {"from": "2026-07-19", "to": "2026-07-19"}
        # Выручка выросла втрое → дельта +2.0.
        assert result["delta"]["revenue_minor"] == pytest.approx(2.0)


# --- Экспорт ---------------------------------------------------------------


def test_export_csv_is_generated(crystal):
    with tenant_context(crystal):
        admin = _admin(crystal)
        _feed(crystal, "order_created", date(2026, 7, 20), {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 500, "items_count": 2}, "e1")

        export = create_export(
            crystal.pk, admin, kind="breakdown", export_format="csv",
            params={"date_from": "2026-07-20", "date_to": "2026-07-20", "dimension": "type"},
        )
        assert export.status == "pending"
        done = execute_export(export.pk, crystal.pk, user=admin)
        assert done.status == "ready"
        assert done.row_count == 1
        assert done.content_type == "text/csv"

        reader = list(csv.reader(io.StringIO(bytes(done.content).decode("utf-8-sig"))))
        assert reader[0][:2] == ["key", "label"]
        assert reader[1][0] == "product"


def test_export_xlsx_is_a_valid_zip(crystal):
    import zipfile

    data = render_csv(["a", "b"], [[1, 2]])  # csv sanity
    assert b"a,b" in data

    from apps.analytics.export import render_xlsx

    blob = render_xlsx(["metric", "value"], [["orders", 5]])
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = zf.namelist()
        assert "[Content_Types].xml" in names
        assert "xl/worksheets/sheet1.xml" in names
        assert b"orders" in zf.read("xl/worksheets/sheet1.xml")


# --- API -------------------------------------------------------------------


def test_summary_endpoint_scopes_to_point_senior(cms, crystal):
    # chef — старший кухни: эндпоинт отвечает и отдаёт его срез.
    response = cms.get("/api/cms/analytics/summary?preset=month")
    assert response.status_code == 200, response.content
    body = response.json()
    assert "current" in body and "orders" in body["current"]
    # Старшему точки трафик не раскрывается.
    assert body["current"]["sessions"] is None

    scope = cms.get("/api/cms/analytics/scope").json()
    assert scope["all_points"] is False
    assert any(p["code"] == "kitchen" for p in scope["points"])
