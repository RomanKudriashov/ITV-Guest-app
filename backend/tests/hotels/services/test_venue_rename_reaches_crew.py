"""
ПЕРЕИМЕНОВАНИЕ ЗАВЕДЕНИЯ ДОЕЗЖАЕТ ДО ВСЕХ, КТО ЕГО НАЗЫВАЕТ.

Служебное имя исполнителя заводится копией с гостевого и своего редактора не
имеет — но `update_service` его не обновлял. Витрина показывала новое имя, а
трекер, эскалации, привязки каналов, слоты и аналитика — то, что было в момент
создания, и разъезд не лечился ничем, кроме SQL.

Семь мест, где имя видит человек, приезжают из пяти выдач: bootstrap CMS кормит
сразу три экрана (каналы, эскалации, слоты) одним списком точек.
"""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Service

from tests.conftest import host_for

pytestmark = pytest.mark.django_db

NEW = "Панорама на крыше"


@pytest.fixture
def renamed(cms):
    """Переименовываем «Панораму» — заведение с кухней, персоналом и заказами."""
    services = cms.get("/api/v1/cms/services").json()["items"]
    kitchen = next(s for s in services if s["code"] == "kitchen")
    assert kitchen["public_name"]["ru"] == "Панорама"
    assert kitchen["execution_point"]["title"]["ru"] == "Кухня ресторана"  # разъезд из сида

    # Строка аналитики ДО переименования: именно она потом поедет под новым
    # именем — цена синхронизации, а не побочный эффект теста.
    from apps.analytics.models import OrderDaily

    with tenant_context(cms.hotel):
        OrderDaily.objects.create(
            business_date=timezone.localdate(),
            offering_type="product",
            point_key=kitchen["execution_point"]["id"],
            orders_count=1,
            completed_count=1,
        )

    cms.patch(f"/api/v1/cms/services/{kitchen['id']}", {"public_name": {"ru": NEW, "en": NEW}})
    return kitchen


def test_rename_reaches_the_storefront(renamed, client, crystal, guest_token):
    """1. Витрина гостя — то, ради чего имя и меняли."""
    home = client.get(
        "/api/v1/guest/home", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {guest_token}"
    ).json()
    titles = {tile.get("title") for tile in home["tiles"]}
    assert NEW in titles


def test_rename_reaches_the_venue_list(renamed, cms):
    """2. Список заведений в CMS — там же, где переименовывали."""
    services = cms.get("/api/v1/cms/services").json()["items"]
    kitchen = next(s for s in services if s["code"] == "kitchen")
    assert kitchen["execution_point"]["title"]["ru"] == NEW


def test_rename_reaches_channels_escalations_and_slots(renamed, cms):
    """3-5. Каналы, эскалации и слоты выбирают точку из одного списка bootstrap."""
    points = cms.get("/api/v1/cms/bootstrap").json()["execution_points"]
    kitchen = next(p for p in points if p["code"] == "kitchen")
    assert kitchen["title"]["ru"] == NEW


def test_rename_reaches_the_tracker(renamed, tracker):
    """6. Переключатель доски у повара."""
    points = tracker.get("/api/tracker/points").json()["points"]
    assert NEW in {point["title"] for point in points}


def test_rename_reaches_analytics(renamed, cms):
    """
    7. Разрез по точкам в аналитике.

    Подпись резолвится по `ExecutionPoint.title` уже ПОСЛЕ агрегации, поэтому
    вчерашние строки едут под новым именем — это и есть цена синхронизации, и
    здесь она зафиксирована нарочно: строка заведена ДО переименования.
    """
    rows = cms.get("/api/cms/analytics/operations?preset=month").json()["by_point"]
    assert NEW in {row.get("label") for row in rows}


def test_service_keeps_its_crew_name_when_something_else_changes(cms):
    """
    Обратная сторона: правка соседнего поля имя не трогает.

    Иначе «синхронизировать» превратилось бы в «переписывать при каждом
    сохранении», и заведение с пустым `public_name` обнулило бы доску.
    """
    services = cms.get("/api/v1/cms/services").json()["items"]
    bar = next(s for s in services if s["code"] == "bar")
    before = bar["execution_point"]["title"]

    cms.patch(f"/api/v1/cms/services/{bar['id']}", {"sla_minutes": 33})

    with tenant_context(cms.hotel):
        point = Service.objects.get(code="bar").execution_point
        assert point.title == before
        assert point.sla_minutes == 33
