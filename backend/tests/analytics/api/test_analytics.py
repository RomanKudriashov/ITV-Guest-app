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

from apps.analytics.services import collector, queries
from apps.analytics.services.export import create_export, execute_export, render_csv
from apps.analytics.models import (
    ItemDaily,
    OrderDaily,
    ReviewDaily,
    SessionDaily,
)
from apps.analytics.services.recompute import recompute_aggregates
from apps.analytics.services.scope import scope_for
from apps.core.context import tenant_context

from tests.conftest import host_for

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
    from apps.orders.services.tracker import accept_order

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
        assert sum(r.low_count for r in rd) == 1  # 2 ≤ порог 2


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
    from apps.orders.services.tracker import accept_order

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
    from apps.analytics.services.dimensions import business_date_for

    # 22:30 UTC 20-го июля в Москве (+3) — это уже 21-е июля по времени отеля.
    moment = datetime(2026, 7, 20, 22, 30, tzinfo=dt_timezone.utc)
    assert crystal.timezone == "Europe/Moscow"
    assert business_date_for(crystal, moment) == date(2026, 7, 21)


# --- Скоуп прав ------------------------------------------------------------


def test_analytics_scope_follows_the_role(crystal):
    """
    С R3 аналитика — инструмент управляющего, а не всякого, кто привязан к
    точке. Повар (LEAD кухни) цифр не видит, управляющий рестораном видит свою
    кухню, админ отеля — весь отель.
    """
    with tenant_context(crystal):
        from apps.accounts.models import User

        chef = User.objects.get(email="chef@crystal.local")  # линейный, LEAD
        manager = User.objects.get(email="manager.restaurant@crystal.local")
        admin = _admin(crystal)
        kitchen, concierge = _point_id("kitchen"), _point_id("concierge")

        _feed(crystal, "order_created", date(2026, 7, 20),
              {"offering_type": "product", "point_key": kitchen}, {"revenue_minor": 500, "items_count": 1}, "k1")
        _feed(crystal, "order_created", date(2026, 7, 20),
              {"offering_type": "service_request", "point_key": concierge}, {"revenue_minor": 0, "items_count": 1}, "c1")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20"}
        assert queries.summary(crystal, manager, params)["current"]["orders"] == 1  # своя кухня
        assert queries.summary(crystal, admin, params)["current"]["orders"] == 2  # весь отель
        assert queries.summary(crystal, chef, params)["current"]["orders"] == 0  # линейному нечего

        # Трафик недоступен и управляющему: сессия не привязана к точке.
        assert queries.traffic(crystal, manager, params)["available"] is False
        assert scope_for(manager).all_points is False
        assert scope_for(manager).point_ids == [str(kitchen)]
        assert scope_for(chef).point_ids == []
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

    from apps.analytics.services.export import render_xlsx

    blob = render_xlsx(["metric", "value"], [["orders", 5]])
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = zf.namelist()
        assert "[Content_Types].xml" in names
        assert "xl/worksheets/sheet1.xml" in names
        assert b"orders" in zf.read("xl/worksheets/sheet1.xml")


# --- API -------------------------------------------------------------------


def test_summary_endpoint_scopes_to_service_manager(cms_manager, cms_line_staff):
    """Управляющий получает срез своего заведения; линейного к цифрам не пускают."""
    response = cms_manager.get("/api/cms/analytics/summary?preset=month")
    assert response.status_code == 200, response.content
    body = response.json()
    assert "current" in body and "orders" in body["current"]
    # Трафик — уровень отеля: сессия гостя не привязана к заведению.
    assert body["current"]["sessions"] is None

    scope = cms_manager.get("/api/cms/analytics/scope").json()
    assert scope["all_points"] is False
    assert [p["code"] for p in scope["points"]] == ["kitchen"]

    assert cms_line_staff.get("/api/cms/analytics/summary?preset=month").status_code == 403


def test_unparseable_period_is_refused_not_silently_replaced(cms):
    """
    Мусор в дате — отказ, а не другой период.

    Раньше неразбираемая дата молча превращалась в «последние 7 дней»: ответ
    приходил 200, с цифрами за НЕ ТЕ сутки, и единственным следом было эхо
    периода в теле. Опечатка в отчёте руководству так не ловится.
    """
    for params in ("date_from=2026-13-45&date_to=2026-07-20", "date_from=2026-07-20&date_to=вчера"):
        response = cms.get(f"/api/cms/analytics/summary?{params}")
        assert response.status_code == 422, (params, response.content)
        body = response.json()
        assert body["code"] == "bad_date"
        assert body["field"] in ("date_from", "date_to")

    # Пустой параметр — это «не прислали», у него по-прежнему есть умолчание.
    assert cms.get("/api/cms/analytics/summary?date_from=&date_to=").status_code == 200


def test_unknown_preset_is_refused(cms):
    """Неизвестный пресет — тоже отказ: молча отдать неделю значит соврать."""
    response = cms.get("/api/cms/analytics/summary?preset=quarter")
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "bad_preset"

    for preset in ("today", "week", "month"):
        assert cms.get(f"/api/cms/analytics/summary?preset={preset}").status_code == 200


# --- Часовой разрез --------------------------------------------------------


def _feed_at(hotel, kind, occurred_at, *, order_id, key, measures=None):
    """Факт с заданным моментом и заказом — часовому разрезу нужно и то, и другое."""
    collector.record(
        hotel.pk,
        {
            "dedupe_key": key,
            "kind": kind,
            "name": kind,
            "occurred_at": occurred_at,
            # Сутки заказа — сутки СОЗДАНИЯ, так их проставляет сборщик и для
            # завершения тоже (collector.build_completed).
            "business_date": date(2026, 7, 20),
            "order_id": order_id,
            "dimensions": {"offering_type": "product", "point_key": ""},
            "measures": measures or {},
        },
    )


def test_hourly_granularity_buckets_by_hotel_hour(crystal, cms):
    """
    Часы считаются по-настоящему, в поясе отеля, а не выдаются за сутки.

    Отель в Europe/Moscow (UTC+3): 09:00 UTC — это 12:00 у отеля.
    """
    import uuid

    first, second = uuid.uuid4(), uuid.uuid4()
    _feed_at(crystal, "order_created", datetime(2026, 7, 20, 9, 0, tzinfo=dt_timezone.utc),
             order_id=first, key="h-1", measures={"revenue_minor": 700})
    _feed_at(crystal, "order_created", datetime(2026, 7, 20, 20, 0, tzinfo=dt_timezone.utc),
             order_id=second, key="h-2", measures={"revenue_minor": 300})

    response = cms.get(
        "/api/cms/analytics/timeseries?date_from=2026-07-20&date_to=2026-07-20&granularity=hour"
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["granularity"] == "hour"
    assert len(body["points"]) == 24

    by_bucket = {point["bucket"]: point for point in body["points"]}
    assert by_bucket["2026-07-20T12:00"]["orders"] == 1
    assert by_bucket["2026-07-20T12:00"]["revenue_minor"] == 700
    assert by_bucket["2026-07-20T23:00"]["orders"] == 1
    assert by_bucket["2026-07-20T23:00"]["revenue_minor"] == 300
    # Остальные часы существуют и пусты — график не должен рваться.
    assert by_bucket["2026-07-20T13:00"]["orders"] == 0


def test_hourly_sums_match_the_day(crystal, cms):
    """
    Часы обязаны складываться в сутки.

    Завершение относится к часу СОЗДАНИЯ заказа, как сутки относят его к дате
    создания. Иначе заказ, сделанный в 12:00 и завершённый в 21:00, попал бы в
    разные столбики двух разрезов одного дашборда.
    """
    import uuid

    order = uuid.uuid4()
    _feed_at(crystal, "order_created", datetime(2026, 7, 20, 9, 0, tzinfo=dt_timezone.utc),
             order_id=order, key="s-1", measures={"revenue_minor": 500})
    _feed_at(crystal, "order_completed", datetime(2026, 7, 20, 18, 0, tzinfo=dt_timezone.utc),
             order_id=order, key="s-2")

    window = "date_from=2026-07-20&date_to=2026-07-20"
    hourly = cms.get(f"/api/cms/analytics/timeseries?{window}&granularity=hour").json()["points"]
    daily = cms.get(f"/api/cms/analytics/timeseries?{window}&granularity=day").json()["points"]

    for measure in ("orders", "revenue_minor", "completed", "cancelled"):
        assert sum(point[measure] for point in hourly) == sum(point[measure] for point in daily), measure

    by_bucket = {point["bucket"]: point for point in hourly}
    # Завершение — в 12:00 (час создания), а не в 21:00 (час завершения).
    assert by_bucket["2026-07-20T12:00"]["completed"] == 1
    assert by_bucket["2026-07-20T21:00"]["completed"] == 0


def test_unknown_granularity_is_refused(cms):
    """Мусор в разрезе — отказ. Раньше считалось посуточно, а в эхо уходило «quarter»."""
    response = cms.get("/api/cms/analytics/timeseries?preset=week&granularity=quarter")
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "bad_granularity"

    for granularity in ("hour", "day", "week"):
        assert cms.get(
            f"/api/cms/analytics/timeseries?preset=today&granularity={granularity}"
        ).status_code == 200, granularity


def test_hourly_range_is_bounded(cms):
    """Год в часах — 8760 столбиков, это не график. Отказ с внятной причиной."""
    response = cms.get(
        "/api/cms/analytics/timeseries?date_from=2025-07-20&date_to=2026-07-20&granularity=hour"
    )
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "range_too_large"
    # День/неделя за тот же период по-прежнему считаются.
    assert cms.get(
        "/api/cms/analytics/timeseries?date_from=2025-07-20&date_to=2026-07-20&granularity=week"
    ).status_code == 200


def test_reversed_range_is_refused(cms):
    """
    Перепутанные границы — опечатка, а не намерение.

    Раньше они молча менялись местами, хотя контракт для этой же ситуации уже
    требовал отказа (hotel-admin-api-contract.md: `from > to` — 422 bad_range).
    """
    response = cms.get("/api/cms/analytics/summary?date_from=2026-07-25&date_to=2026-07-20")
    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == "bad_range"
    assert body["field"] == "date_from"

    # Границы в правильном порядке и совпадающие границы — по-прежнему норма.
    assert cms.get("/api/cms/analytics/summary?date_from=2026-07-20&date_to=2026-07-25").status_code == 200
    assert cms.get("/api/cms/analytics/summary?date_from=2026-07-20&date_to=2026-07-20").status_code == 200


# --- Разрез по категории номера --------------------------------------------


def test_room_category_is_a_snapshot_not_a_lookup_by_room(crystal, django_capture_on_commit_callbacks):
    """
    САМОЕ ВАЖНОЕ В ЭТОМ РАЗРЕЗЕ: категория снимается в момент заказа.

    Резолв по комнате был бы проще и неверен: перевели комнату из «Стандарта» в
    «Делюкс» — и мартовская выручка задним числом переехала бы в «Делюкс».
    Проверяем именно это: после смены категории комнаты прошлый заказ остаётся
    в прежней категории.
    """
    from apps.analytics.services import dimensions as dim
    from apps.hotels.models import Room, RoomCategory
    from apps.orders.models import Order

    with tenant_context(crystal):
        # Коды СВОИ, не из демо-набора: с волны 10 сид заводит отелю
        # «standard/deluxe/suite», и тест, взявший те же коды, падал бы на
        # уникальном ограничении — то есть зависел бы от содержимого сида.
        standard = RoomCategory.objects.create(code="an-standard", title={"ru": "Стандарт"})
        deluxe = RoomCategory.objects.create(code="an-deluxe", title={"ru": "Делюкс"})
        room = Room.objects.create(number="7001", category=standard)

        order = Order(room=room)
        assert dim.room_category_for_order(order) == str(standard.pk)

        # Слепок уже снят — дальше он живёт сам.
        snapshot = dim.room_category_for_order(order)

        room.category = deluxe
        room.save()
        room.refresh_from_db()

        assert snapshot == str(standard.pk), "снимок не меняется вслед за комнатой"
        assert dim.room_category_for_order(Order(room=room)) == str(deluxe.pk), (
            "новый заказ той же комнаты уже несёт новую категорию"
        )


def test_breakdown_by_room_category_compares_per_room(crystal):
    """
    Сравнение категорий, а не столбик абсолютных чисел.

    Люксов мало, стандартов много — «люкс принёс меньше» ничего не значит.
    Ответ даётся на номер, и отношение считается к самой слабой категории.
    """
    from apps.hotels.models import Room, RoomCategory

    with tenant_context(crystal):
        admin = _admin(crystal)
        suite = RoomCategory.objects.create(code="an-suite", title={"ru": "Люкс"})
        standard = RoomCategory.objects.create(code="an-std", title={"ru": "Стандарт"})
        # Два люкса и десять стандартов — как в жизни.
        for index in range(2):
            Room.objects.create(number=f"S{index}", category=suite)
        for index in range(10):
            Room.objects.create(number=f"T{index}", category=standard)

        bd = date(2026, 7, 20)
        for index in range(6):
            _feed(crystal, "order_created", bd,
                  {"offering_type": "product", "point_key": "k", "room_category_key": str(suite.pk)},
                  {"revenue_minor": 100, "items_count": 1}, f"suite-{index}")
        for index in range(10):
            _feed(crystal, "order_created", bd,
                  {"offering_type": "product", "point_key": "k", "room_category_key": str(standard.pk)},
                  {"revenue_minor": 100, "items_count": 1}, f"std-{index}")

        params = {"date_from": "2026-07-20", "date_to": "2026-07-20", "dimension": "room_category"}
        rows = {row["key"]: row for row in queries.breakdown(crystal, admin, params)["rows"]}

        assert rows[str(suite.pk)]["orders"] == 6
        assert rows[str(standard.pk)]["orders"] == 10
        # На номер: 3 против 1 — люкс заказывает втрое чаще.
        assert rows[str(suite.pk)]["orders_per_room"] == 3.0
        assert rows[str(standard.pk)]["orders_per_room"] == 1.0
        assert rows[str(suite.pk)]["ratio_to_base"] == 3.0
        assert rows[str(suite.pk)]["base_label"] == "Стандарт"
        assert rows[str(suite.pk)]["label"] == "Люкс"


def test_orders_without_category_stay_in_the_breakdown(crystal):
    """
    «Без категории» НЕ прячется: иначе сумма долей перестанет сходиться с
    итогом, а заказы, созданные до появления разреза, исчезнут без объяснения.
    """
    from apps.hotels.models import RoomCategory

    with tenant_context(crystal):
        admin = _admin(crystal)
        suite = RoomCategory.objects.create(code="suite2", title={"ru": "Люкс"})
        bd = date(2026, 7, 21)
        _feed(crystal, "order_created", bd,
              {"offering_type": "product", "point_key": "k", "room_category_key": str(suite.pk)},
              {"revenue_minor": 300, "items_count": 1}, "with-cat")
        # Строка без категории — ровно то, чем будут все прошлые записи.
        _feed(crystal, "order_created", bd,
              {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 700, "items_count": 1}, "no-cat")

        params = {"date_from": "2026-07-21", "date_to": "2026-07-21", "dimension": "room_category"}
        result = queries.breakdown(crystal, admin, params)
        rows = {row["key"]: row for row in result["rows"]}

        assert "" in rows, "строка «без категории» обязана остаться"
        assert rows[""]["orders"] == 1
        # Сумма долей сходится с единицей — то самое, ради чего её не прячут.
        assert abs(sum(row["share"] for row in result["rows"]) - 1) < 0.001
        # В сравнении она не участвует: номеров под ней может не быть вовсе.
        assert rows[""]["orders_per_room"] is None


def test_room_category_filter_narrows_the_summary(crystal):
    from apps.hotels.models import RoomCategory

    with tenant_context(crystal):
        admin = _admin(crystal)
        suite = RoomCategory.objects.create(code="suite3", title={"ru": "Люкс"})
        bd = date(2026, 7, 22)
        _feed(crystal, "order_created", bd,
              {"offering_type": "product", "point_key": "k", "room_category_key": str(suite.pk)},
              {"revenue_minor": 100, "items_count": 1}, "c1")
        _feed(crystal, "order_created", bd,
              {"offering_type": "product", "point_key": "k"},
              {"revenue_minor": 100, "items_count": 1}, "c2")

        params = {"date_from": "2026-07-22", "date_to": "2026-07-22"}
        assert queries.summary(crystal, admin, params)["current"]["orders"] == 2
        narrow = {**params, "room_category": str(suite.pk)}
        assert queries.summary(crystal, admin, narrow)["current"]["orders"] == 1
        # «Без категории» фильтруется словом `none`: пустую строку в параметре
        # не отличить от «фильтр не задан».
        empty = {**params, "room_category": "none"}
        assert queries.summary(crystal, admin, empty)["current"]["orders"] == 1


def test_the_reviews_report_carries_totals_and_a_row_per_venue(crystal, django_capture_on_commit_callbacks):
    """Плитки и таблица вкладки «Отзывы» читают ровно эти поля."""
    from apps.accounts.models import User
    from apps.analytics.services import queries
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
            create_review(get_order(order.pk), guest_session=session, rating=4)
        owner = User.objects.get(email="owner@crystal.local")
        body = queries.reviews(crystal, owner, {"preset": "today"})

    assert body["totals"]["reviews"] == 1
    assert body["totals"]["avg_rating"] == 4
    assert [row["reviews"] for row in body["by_point"]] == [1]
    assert body["by_point"][0]["label"], "заведение названо, а не кодом"
    assert body["by_point"][0]["share"] == 1


# --- Операции: форма, которую читает вкладка -------------------------------


def _operations_feed(hotel, kitchen, spa):
    """
    Кухня: три заказа, два приняты (60 и 120 с), один выполнен за 300 с, один
    отменён, один вне часов. СПА: один заказ, НИ ОДНОГО принятия — его среднее
    обязано быть «нет», а не ноль.
    """
    bd = date(2026, 7, 20)
    k = {"offering_type": "product", "point_key": kitchen}
    for n in range(3):
        _feed(hotel, "order_created", bd, k, {"revenue_minor": 100, "items_count": 1,
                                             "off_hours": 1 if n == 0 else 0}, f"op-k{n}")
    _feed(hotel, "order_accepted", bd, k, {"reaction_seconds": 60}, "op-ka1")
    _feed(hotel, "order_accepted", bd, k, {"reaction_seconds": 120}, "op-ka2")
    _feed(hotel, "order_completed", bd, k, {"fulfil_seconds": 300}, "op-kc1")
    _feed(hotel, "order_cancelled", bd, k, {}, "op-kx1")
    _feed(hotel, "order_created", bd, {"offering_type": "slot", "point_key": spa},
          {"revenue_minor": 0, "items_count": 1}, "op-s1")


def test_operations_totals_come_from_sums_not_from_rows(crystal):
    """
    Плитки вкладки «Операции» читают `totals`, таблица — `by_point`. Вкладка
    однажды читала поля, которых сервер не слал, и рисовала NaN при живых
    данных; эти поля и их смысл закреплены здесь.
    """
    with tenant_context(crystal):
        admin = _admin(crystal)
        kitchen, spa = _point_id("kitchen"), _point_id("spa")
        _operations_feed(crystal, kitchen, spa)
        body = queries.operations(crystal, admin, {"date_from": "2026-07-20", "date_to": "2026-07-20"})

    totals = body["totals"]
    assert totals["orders"] == 4
    assert totals["cancelled"] == 1
    assert totals["cancel_rate"] == 0.25
    assert totals["off_hours_rate"] == 0.25
    # Среднее по отелю — сумма секунд на число принятий (180/2), а не среднее
    # средних отделов: отдел без принятий в знаменатель не входит.
    assert totals["avg_reaction_seconds"] == 90
    assert totals["avg_fulfil_seconds"] == 300

    rows = {row["key"]: row for row in body["by_point"]}
    assert rows[kitchen]["orders"] == 3
    assert rows[kitchen]["cancel_rate"] == round(1 / 3, 4)
    assert rows[kitchen]["avg_reaction_seconds"] == 90
    assert rows[kitchen]["label"], "заведение названо, а не ключом"
    # Не было ни одного принятия — «нет», а не «0 секунд».
    assert rows[spa]["avg_reaction_seconds"] is None
    assert rows[spa]["avg_fulfil_seconds"] is None
    assert rows[spa]["cancel_rate"] == 0
    assert rows[spa]["escalations"] == 0
    assert body["escalations"] == {"fired": 0}


def test_operations_on_an_empty_period_answers_with_zeros_and_nulls(crystal):
    with tenant_context(crystal):
        admin = _admin(crystal)
        body = queries.operations(crystal, admin, {"date_from": "2020-01-01", "date_to": "2020-01-01"})

    assert body["by_point"] == []
    # Счётчики — ноль; доли и средние без единого заказа — «нет значения»,
    # а не ноль (партия 31, INV-05 QA: «0s» против «—»).
    assert body["totals"] == {
        "orders": 0, "completed": 0, "cancelled": 0, "cancel_rate": None, "off_hours_rate": None,
        "avg_reaction_seconds": None, "avg_fulfil_seconds": None,
    }
    assert body["escalations"] == {"fired": 0}


def test_operations_count_escalations_per_venue(crystal, django_capture_on_commit_callbacks):
    """Срабатывание журнала относится к заведению ЗАКАЗА и в сумме равно итогу."""
    from apps.notifications.models import NotificationLog
    from apps.orders.services import OrderInput, OrderLineInput, create_order

    with tenant_context(crystal):
        admin = _admin(crystal)
        with django_capture_on_commit_callbacks(execute=True):
            order = create_order(
                OrderInput(lines=[OrderLineInput(item_id=_item_id())], room_id=None),
                guest_session=_session(),
            )
        # Две ступени сработали, одна ещё ждёт — в счёт идут только сработавшие.
        for index, status in enumerate(("sent", "sent", "scheduled")):
            NotificationLog.objects.create(
                order=order, step_index=index, status=status, dedupe_key=f"op-esc-{index}",
            )
        body = queries.operations(crystal, admin, {"preset": "today"})

    rows = {row["key"]: row for row in body["by_point"]}
    point = str(order.execution_point_id)
    assert rows[point]["escalations"] == 2
    assert body["escalations"]["fired"] == sum(row["escalations"] for row in body["by_point"])


def test_escalations_are_counted_in_hotel_days_not_server_days(crystal, django_capture_on_commit_callbacks):
    """
    Срабатывание в 00:30 по отелю — это ЕГО сутки, хотя в UTC ещё вчера. Счёт
    по `created_at__date` (дата сервера) относил его к прошлому дню.
    """
    from datetime import datetime as dt, time, timedelta

    from apps.analytics.services.queries import Period, _escalations_by_point
    from apps.notifications.models import NotificationLog
    from apps.orders.services import OrderInput, OrderLineInput, create_order

    with tenant_context(crystal):
        admin = _admin(crystal)
        with django_capture_on_commit_callbacks(execute=True):
            order = create_order(
                OrderInput(lines=[OrderLineInput(item_id=_item_id())], room_id=None),
                guest_session=_session(),
            )
        day = date(2026, 7, 20)
        moment = dt.combine(day, time(0, 30)).replace(tzinfo=crystal.tzinfo)
        assert moment.utcoffset() > timedelta(0), "проверка имеет смысл только восточнее UTC"
        log = NotificationLog.objects.create(order=order, status="sent", dedupe_key="tz-edge")
        NotificationLog.objects.filter(pk=log.pk).update(created_at=moment)

        counts = _escalations_by_point(scope_for(admin), Period(day, day), crystal)

    assert counts == {str(order.execution_point_id): 1}


def test_scope_carries_the_flags_the_filter_panel_reads(crystal):
    """
    Панель фильтров аналитики читает `is_hotel_admin` и `is_platform_admin`.
    Второго сервер не слал никогда (слал `is_platform`, которого не читал
    никто) — бэклог 47, найдено сторожем контракта.
    """
    from apps.accounts.models import User
    from apps.analytics.services.scope import scope_payload

    with tenant_context(crystal):
        owner = User.objects.get(email="owner@crystal.local")
        body = scope_payload(owner)

    assert body["is_hotel_admin"] is True
    assert body["is_platform_admin"] is False
    assert "is_platform" not in body



def test_average_check_counts_only_priced_orders_that_were_not_cancelled(crystal):
    """
    Партия 31 (INV-05 QA): средний чек делился на ВСЕ заказы — отменённый и
    бесплатный тянули его вниз. Теперь: выручка неотменённых с ценой / их число.
    Отдельный день, сырые события — чтобы сид не участвовал.
    """
    from datetime import date, datetime, timezone as tz

    from apps.analytics.services import collector

    day = date(2020, 2, 2)
    at = datetime(2020, 2, 2, 12, tzinfo=tz.utc)

    def raw(kind, key, revenue):
        return {
            "dedupe_key": f"{kind}:{key}", "bus_event_id": None, "kind": kind, "name": kind,
            "occurred_at": at, "business_date": day, "order_id": None, "dimensions": {},
            "measures": {"revenue_minor": revenue},
        }

    with tenant_context(crystal):
        for item in (
            raw("order_created", "a", 1000),
            raw("order_created", "b", 3000),
            raw("order_created", "free", 0),
            raw("order_cancelled", "b", 3000),
        ):
            collector.record(crystal.pk, item)
        body = queries.summary(crystal, _admin(crystal), {"date_from": "2020-02-02", "date_to": "2020-02-02"})

    current = body["current"]
    assert current["orders"] == 3
    assert current["avg_check_minor"] == 1000, "по прежней формуле было бы 4000 / 3"


# --- Лента среза: страницами, итоги отдельно (п.18) -------------------------


def _orders(count: int, quantity_of=lambda i: 1):
    from apps.orders.services import OrderInput, OrderLineInput, create_order

    session = _session()
    for index in range(count):
        create_order(
            OrderInput(lines=[OrderLineInput(item_id=_item_id(), quantity=quantity_of(index))], room_id=None),
            guest_session=session,
        )


def test_drilldown_comes_in_pages_and_the_summary_counts_the_whole_slice(crystal, monkeypatch):
    """Лента — страницами (здесь по 3), итог — по всему срезу, а не по странице."""
    monkeypatch.setattr(queries, "DRILLDOWN_PAGE", 3)
    with tenant_context(crystal):
        admin = _admin(crystal)
        _orders(7)
        params = {"preset": "today"}
        pages = [queries.drilldown(crystal, admin, {**params, "page": n}) for n in (1, 2, 3)]
        summary = queries.drilldown_summary(crystal, admin, params)

    assert [len(page["orders"]) for page in pages] == [3, 3, 1]
    assert [page["has_more"] for page in pages] == [True, True, False]
    numbers = [row["number"] for page in pages for row in page["orders"]]
    assert len(set(numbers)) == 7, "страницы не повторяют и не теряют строки"
    assert summary["total"] == 7
    assert summary["total_minor"] == sum(row["total_minor"] for page in pages for row in page["orders"])


def test_drilldown_sorts_on_the_server_across_pages(crystal, monkeypatch):
    """Сортировка по колонке — по всему срезу: первая страница по сумме — самые дорогие."""
    monkeypatch.setattr(queries, "DRILLDOWN_PAGE", 2)
    with tenant_context(crystal):
        admin = _admin(crystal)
        _orders(5, quantity_of=lambda i: i + 1)
        first = queries.drilldown(crystal, admin, {"preset": "today", "sort": "total_minor", "order": "desc"})
        everything = queries.drilldown_summary(crystal, admin, {"preset": "today"})

    totals = [row["total_minor"] for row in first["orders"]]
    assert totals == sorted(totals, reverse=True)
    assert everything["total"] == 5
    assert totals[0] == max(totals) and totals[0] >= everything["total_minor"] / 5


def test_export_of_the_slice_takes_every_page_not_the_first(crystal, monkeypatch):
    """Выгрузка берёт весь срез: раньше лента резалась на 200, и выгрузка теряла остальное."""
    from apps.analytics.services.export import build_dataset

    monkeypatch.setattr(queries, "DRILLDOWN_PAGE", 2)
    with tenant_context(crystal):
        admin = _admin(crystal)
        _orders(5)
        _headers, rows = build_dataset(crystal, admin, "drilldown", {"preset": "today"})
    assert len(rows) == 5
