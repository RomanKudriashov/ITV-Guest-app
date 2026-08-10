"""
Маршрутизация категории на исполнителя из CMS (R4).

До R4 маршруты заводил только сид: отель, создавший категорию через админку,
не мог сказать, кто её исполняет. Работало это лишь потому, что резолвер
заказа падает на соглашения — то есть система угадывала за отель, и иногда
угадывала неверно, молча.

Главная проверка здесь — не «CRUD работает», а что CMS показывает ТУ ЖЕ
правду, которая применится к реальному заказу.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Category, Item, Route
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint

pytestmark = pytest.mark.django_db


def category_id_by_code(crystal, code: str) -> str:
    with tenant_context(crystal):
        return str(Category.objects.get(code=code).pk)


def point_id_by_code(crystal, code: str) -> str:
    with tenant_context(crystal):
        return str(ExecutionPoint.objects.get(code=code).pk)


# --- Чтение ----------------------------------------------------------------


def test_shows_the_explicit_route(cms, crystal):
    body = cms.get(f"/api/cms/categories/{category_id_by_code(crystal, 'hot')}/routes").json()

    assert body["effective_source"] == "route"
    assert body["effective"]["execution_point_code"] == "kitchen"
    assert [r["execution_point_code"] for r in body["routes"]] == ["kitchen"]


def test_shows_the_convention_fallback_honestly(cms, crystal):
    """
    Категория без маршрута всё равно исполняется — по совпадению кодов. Пустой
    список маршрутов без этой пометки читался бы как «не настроено», и админ
    чинил бы то, что не сломано.
    """
    with tenant_context(crystal):
        bar_point = ExecutionPoint.objects.get(code="bar")
        category = Category.objects.create(
            code="bar", type="product", title={"ru": "Барная карта"}
        )
        assert not Route.objects.filter(category=category).exists()

    body = cms.get(f"/api/cms/categories/{category.pk}/routes").json()
    assert body["routes"] == []
    assert body["effective_source"] == "convention"
    assert body["effective"]["execution_point_id"] == str(bar_point.pk)


# --- Запись ----------------------------------------------------------------


def test_replaces_routes_and_order_is_priority(cms, crystal):
    category = category_id_by_code(crystal, "hot")
    bar, kitchen = point_id_by_code(crystal, "bar"), point_id_by_code(crystal, "kitchen")

    body = cms.put(
        f"/api/cms/categories/{category}/routes",
        {"routes": [{"execution_point_id": bar}, {"execution_point_id": kitchen}]},
    ).json()

    # Порядок списка = приоритет: первый и есть основной исполнитель.
    assert [r["execution_point_code"] for r in body["routes"]] == ["bar", "kitchen"]
    assert [r["priority"] for r in body["routes"]] == [0, 1]
    assert body["effective"]["execution_point_code"] == "bar"
    assert body["effective_source"] == "route"


def test_new_route_actually_moves_the_order(cms, crystal, client):
    """
    Ради этого эндпоинт и заводился: назначение в CMS обязано менять то, куда
    реально уедет заказ, а не только строку в базе.
    """
    # Приватная функция — из СВОЕГО модуля: звёздный реэкспорт пакета
    # приватные имена не переносит, и это правильно.
    from apps.orders.services.services import _resolve_execution_point

    category = category_id_by_code(crystal, "hot")
    with tenant_context(crystal):
        assert _resolve_execution_point(category).code == "kitchen"

    cms.put(
        f"/api/cms/categories/{category}/routes",
        {"routes": [{"execution_point_id": point_id_by_code(crystal, "bar")}]},
    )

    with tenant_context(crystal):
        assert _resolve_execution_point(category).code == "bar"


def test_empty_list_clears_routes(cms, crystal):
    category = category_id_by_code(crystal, "hot")
    body = cms.put(f"/api/cms/categories/{category}/routes", {"routes": []}).json()

    assert body["routes"] == []
    # Категория «hot» не совпадает с кодом точки, а исполнителей в отеле много —
    # значит, заказ теперь упадёт, и CMS обязана сказать это прямо.
    assert body["effective_source"] == "none"
    assert body["effective"] is None


def test_duplicate_point_is_refused(cms, crystal):
    category = category_id_by_code(crystal, "hot")
    kitchen = point_id_by_code(crystal, "kitchen")

    response = cms.put(
        f"/api/cms/categories/{category}/routes",
        {"routes": [{"execution_point_id": kitchen}, {"execution_point_id": kitchen}]},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "duplicate_route"


def test_unknown_point_is_refused(cms, crystal):
    import uuid

    response = cms.put(
        f"/api/cms/categories/{category_id_by_code(crystal, 'hot')}/routes",
        {"routes": [{"execution_point_id": str(uuid.uuid4())}]},
    )
    assert response.status_code == 422


# --- Права -----------------------------------------------------------------


def test_line_staff_cannot_reroute(cms_line_staff, crystal):
    response = cms_line_staff.get(
        f"/api/cms/categories/{category_id_by_code(crystal, 'hot')}/routes"
    )
    assert response.status_code == 403


def test_manager_cannot_reroute_a_foreign_category(cms_manager, crystal):
    """Маршрут решает, кто исполняет — чужую категорию перенацелить нельзя."""
    response = cms_manager.put(
        f"/api/cms/categories/{category_id_by_code(crystal, 'transfer')}/routes",
        {"routes": [{"execution_point_id": point_id_by_code(crystal, "kitchen")}]},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_my_service"
