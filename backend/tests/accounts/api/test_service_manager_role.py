"""
Роль «управляющий сервисом» и её область (R3).

Три утверждения, ради которых роль вводилась:

  1. линейный персонал в раздел управления не попадает вовсе;
  2. управляющий правит СВОЙ сервис — наполнение, расписание, коммерцию,
     персонал — и видит его аналитику;
  3. в чужой сервис и в настройки отеля он не лезет.

До R3 весь /cms был открыт любому сотруднику отеля: повар мог менять цены и
бренд. Эти тесты — граница, ниже которой откатываться нельзя.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.catalog.models import Category, Item
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


def kitchen_item(crystal) -> str:
    with tenant_context(crystal):
        return str(Item.objects.get(code="caesar").pk)


def bar_service_id(crystal) -> str:
    with tenant_context(crystal):
        return str(Service.objects.get(execution_point__code="bar").pk)


def point_id(crystal, code: str) -> str:
    with tenant_context(crystal):
        return str(ExecutionPoint.objects.get(code=code).pk)


def service_id(crystal, code: str) -> str:
    """С R4 ресурс CMS — сервис; точка исполнения живёт внутри него."""
    with tenant_context(crystal):
        return str(Service.objects.get(execution_point__code=code).pk)


# --- 1. Линейный персонал: только трекер -----------------------------------


def test_line_staff_is_not_let_into_cms(cms_line_staff):
    """
    Повар не правит меню, цены и настройки. Проверяем на разных разделах, а не
    на одном: гейт стоит на входе в CMS, и это должно быть видно.
    """
    for path in ("/api/cms/categories", "/api/cms/items", "/api/cms/brand", "/api/cms/staff"):
        response = cms_line_staff.get(path)
        assert response.status_code == 403, path
        assert response.json()["code"] == "no_cms_access"


def test_line_staff_cannot_change_a_price(cms_line_staff, crystal):
    response = cms_line_staff.patch(
        f"/api/cms/items/{kitchen_item(crystal)}", {"price": 1}
    )
    assert response.status_code == 403


def test_line_staff_still_works_the_tracker(client, crystal):
    """Отняли CMS — но не работу: доска своей точки на месте."""
    from tests.conftest import host_for, staff_token_for

    token = staff_token_for(client, crystal, "chef")
    response = client.get(
        "/api/tracker/orders?point=kitchen",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert response.status_code == 200
    assert response.json()["tracker_type"] == "board"


def test_role_is_reported_on_login(client, crystal):
    """Фронт узнаёт роль из ответа входа, а не выясняет её ошибками 403."""
    from tests.conftest import host_for

    def login(email):
        return client.post(
            "/api/staff/auth/login",
            data={"email": email, "password": "chef12345"},
            content_type="application/json",
            HTTP_HOST=host_for(crystal),
        ).json()["user"]

    assert login("chef@crystal.local")["role"] == "line_staff"
    assert login("chef@crystal.local")["has_cms_access"] is False
    assert login("manager.restaurant@crystal.local")["role"] == "service_manager"
    assert login("owner@crystal.local")["role"] == "hotel_admin"


# --- 2. Управляющий: свой сервис -------------------------------------------


def test_manager_edits_his_own_menu(cms_manager, crystal):
    response = cms_manager.patch(f"/api/cms/items/{kitchen_item(crystal)}", {"price": 99000})
    assert response.status_code == 200, response.content
    assert response.json()["price"] == 99000


def test_manager_sees_only_his_own_catalog(cms_manager, cms, crystal):
    """Чужие разделы не просто закрыты — их нет в списке."""
    # Своё меню (товары кухни) — на месте.
    mine = {node["code"] for node in cms_manager.get("/api/cms/categories").json()}
    assert mine, "управляющий должен видеть своё меню"

    # Чужие разделы заявок (такси консьержа, уборка хозслужбы) — не его.
    path = "/api/cms/categories?type=service_request"
    theirs = {node["code"] for node in cms.get(path).json()}
    manager_sees = {node["code"] for node in cms_manager.get(path).json()}

    assert "transfer" in theirs and "housekeeping" in theirs
    assert manager_sees == set(), "чужих разделов управляющий не видит вовсе"


def test_manager_edits_his_service_commerce_and_schedule(cms_manager, crystal):
    """
    Коммерция и расписание СВОЕГО заведения — работа управляющего. Поля на
    Service завёл R1, править их до R3 было негде.
    """
    response = cms_manager.patch(
        f"/api/cms/services/{service_id(crystal, 'kitchen')}",
        {"service_fee_bp": 700, "min_order_minor": 150000, "tagline": {"ru": "Кухня с видом"}},
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["commerce"]["service_fee_bp"] == 700
    assert body["commerce"]["min_order_minor"] == 150000
    assert body["tagline"]["ru"] == "Кухня с видом"


def test_manager_manages_his_own_staff(cms_manager, crystal):
    listing = cms_manager.get("/api/cms/staff").json()
    emails = {row["email"] for row in listing}

    assert "chef@crystal.local" in emails, "свой повар — его персонал"
    assert "maid@crystal.local" not in emails, "горничная работает не у него"
    assert "owner@crystal.local" not in emails, "админ отеля ему не подчинён"


def test_manager_sees_analytics_of_his_service_only(cms_manager, crystal):
    scope = cms_manager.get("/api/cms/analytics/scope").json()

    assert scope["all_points"] is False
    assert scope["is_hotel_admin"] is False
    assert [point["code"] for point in scope["points"]] == ["kitchen"]


# --- 3. Чужой сервис и уровень отеля ---------------------------------------


def test_manager_cannot_touch_another_service(cms_manager, crystal):
    """Стоп-условие роли: чужое заведение недоступно даже по прямому id."""
    with tenant_context(crystal):
        # Такси обслуживает консьерж — чужой сервис для управляющего рестораном.
        foreign_item = str(Item.objects.get(code="taxi").pk)
        foreign_category = str(Category.objects.get(code="transfer").pk)

    assert cms_manager.get(f"/api/cms/categories/{foreign_category}").status_code == 403
    assert cms_manager.patch(
        f"/api/cms/categories/{foreign_category}", {"is_active": False}
    ).status_code == 403
    assert cms_manager.get(f"/api/cms/items/{foreign_item}").status_code == 403
    assert cms_manager.patch(f"/api/cms/items/{foreign_item}", {"price": 1}).status_code == 403


def test_manager_cannot_touch_another_service_card(cms_manager, crystal):
    response = cms_manager.patch(
        f"/api/cms/services/{service_id(crystal, 'bar')}", {"tagline": {"ru": "Моё"}}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_my_service"


def test_manager_cannot_touch_hotel_settings(cms_manager):
    """Бренд, валюта, номера, локации, витрина — уровень отеля, не сервиса."""
    cases = [
        ("patch", "/api/cms/brand", {"palette": {}}),
        ("patch", "/api/cms/commerce-settings", {"tax_bp": 100}),
        ("post", "/api/cms/rooms", {"number": "999"}),
        ("post", "/api/cms/locations", {"title": {"ru": "Терраса"}}),
        ("put", "/api/cms/showcase", {"group_threshold": 1}),
        ("post", "/api/cms/allergens", {"title": {"ru": "Киви"}}),
        ("post", "/api/cms/services", {"type": "custom", "public_name": {"ru": "Новое заведение"}}),
    ]
    for method, path, body in cases:
        response = getattr(cms_manager, method)(path, body)
        assert response.status_code == 403, f"{method.upper()} {path}"
        assert response.json()["code"] == "hotel_admin_only", path


def test_manager_cannot_change_service_type(cms_manager, crystal):
    """
    Тип заведения решает вид трекера и место на витрине — это уровень отеля,
    даже для своего сервиса.
    """
    response = cms_manager.patch(
        f"/api/cms/services/{service_id(crystal, 'kitchen')}", {"type": "bar"}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "hotel_admin_only"


def test_manager_cannot_grant_himself_the_hotel(cms_manager, crystal):
    """Самый дорогой путь эскалации привилегий — закрыт явным тестом."""
    with tenant_context(crystal):
        manager_id = str(User.objects.get(email="manager.restaurant@crystal.local").pk)
        owner_id = str(User.objects.get(email="owner@crystal.local").pk)

    assert cms_manager.patch(
        f"/api/cms/staff/{manager_id}", {"is_hotel_admin": True}
    ).status_code == 403
    # И до чужого админа он тоже не дотягивается.
    assert cms_manager.patch(
        f"/api/cms/staff/{owner_id}", {"password": "hijacked123"}
    ).status_code == 403


def test_manager_cannot_assign_staff_to_a_foreign_department(cms_manager, crystal):
    with tenant_context(crystal):
        chef_id = str(User.objects.get(email="chef@crystal.local").pk)

    response = cms_manager.put(
        f"/api/cms/staff/{chef_id}/assignments",
        {"assignments": [{"execution_point_id": point_id(crystal, "bar"), "level": "member"}]},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_my_service"


# --- Админ отеля — по-прежнему всюду ---------------------------------------


def test_hotel_admin_keeps_full_access(cms, crystal):
    assert cms.get("/api/cms/categories").status_code == 200
    assert cms.patch("/api/cms/brand", {}).status_code == 200
    assert cms.get("/api/cms/analytics/scope").json()["all_points"] is True
    assert cms.patch(
        f"/api/cms/services/{service_id(crystal, 'bar')}", {"tagline": {"ru": "ок"}}
    ).status_code == 200


def test_manager_level_is_the_role(cms_manager, crystal):
    """
    Роль — это уровень привязки, а не второе поле. Понизили до линейного —
    доступ в CMS исчез в тот же момент, без миграций и синхронизаций.
    """
    assert cms_manager.get("/api/cms/categories").status_code == 200

    with tenant_context(crystal):
        StaffAssignment.objects.filter(
            user__email="manager.restaurant@crystal.local"
        ).update(level=StaffAssignment.Level.MEMBER)

    assert cms_manager.get("/api/cms/categories").status_code == 403
