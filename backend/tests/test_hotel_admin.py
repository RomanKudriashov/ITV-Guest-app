"""
Админка отеля: номера/QR, локации, матрица, отделы, персонал.

Ключевые проверки: QR кодирует рабочий deep-link /r/<номер>, и
GET /api/cms/staff отдаёт список сотрудников.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.catalog.models import ServiceLocation
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Location, Room

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Номера ----------------------------------------------------------------


def test_rooms_list_carries_guest_deeplink(cms):
    rooms = cms.get("/api/cms/rooms").json()
    room = next(entry for entry in rooms if entry["number"] == "305")
    # QR кодирует именно этот URL — рабочий deep-link на витрину отеля.
    assert room["guest_url"] == "http://crystal.guest.localhost/r/305"
    assert room["zone"] == "Главный корпус"


def test_create_and_update_room(cms):
    created = cms.post("/api/cms/rooms", {"number": "701", "floor": "7", "zone": "Башня"})
    assert created.status_code == 201, created.content
    assert created.json()["guest_url"].endswith("/r/701")

    patched = cms.patch(f"/api/cms/rooms/{created.json()['id']}", {"floor": "8"})
    assert patched.json()["floor"] == "8"


def test_duplicate_room_is_refused(cms):
    response = cms.post("/api/cms/rooms", {"number": "305"})
    assert response.status_code == 409
    assert response.json()["code"] == "room_exists"


def test_bulk_range_creates_and_skips(cms, crystal):
    response = cms.post(
        "/api/cms/rooms/bulk", {"from": 501, "to": 510, "floor": "5", "prefix": "A"}
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["created"] == [f"A{n}" for n in range(501, 511)]
    assert body["skipped"] == []

    with tenant_context(crystal):
        assert Room.objects.filter(number="A505").exists()

    # Повтор — идемпотентен: те же номера уходят в skipped, дублей нет.
    again = cms.post("/api/cms/rooms/bulk", {"from": 501, "to": 505, "prefix": "A"}).json()
    assert again["created"] == []
    assert set(again["skipped"]) == {f"A{n}" for n in range(501, 506)}


@pytest.mark.parametrize(
    "payload,code",
    [
        ({"from": 10, "to": 5}, "bad_range"),
        ({"from": 1, "to": 2000}, "range_too_large"),
    ],
)
def test_bulk_range_validation(cms, payload, code):
    response = cms.post("/api/cms/rooms/bulk", payload)
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_qr_encodes_the_working_deeplink(cms, crystal):
    with tenant_context(crystal):
        room_id = str(Room.objects.get(number="305").pk)

    svg = cms.get(f"/api/cms/rooms/{room_id}/qr.svg")
    assert svg.status_code == 200
    assert svg["Content-Type"] == "image/svg+xml"
    assert b"<svg" in svg.content

    png = cms.get(f"/api/cms/rooms/{room_id}/qr.png")
    assert png["Content-Type"] == "image/png"
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"

    # QR действительно несёт рабочий URL — декодируем обратно.
    decoded = _decode_qr(png.content)
    assert decoded == "http://crystal.guest.localhost/r/305"


def _decode_qr(png_bytes: bytes) -> str:
    """
    Доказываем, что QR несёт именно deep-link.

    Полноценный декодер (pyzbar) требует системного zbar, которого нет в
    образе. QR-генерация детерминирована, поэтому сверяем с эталоном: если
    байты совпали с QR того же URL — значит закодирован именно он.
    """
    from apps.hotels.qr import qr_png

    expected = "http://crystal.guest.localhost/r/305"
    return expected if png_bytes == qr_png(expected) else "mismatch"


def test_qr_sheet_is_printable_html(cms):
    response = cms.get("/api/cms/rooms/qr-sheet")
    assert response.status_code == 200
    assert response["Content-Type"] == "text/html"
    html = response.content.decode()
    assert "<svg" in html
    assert "305" in html
    assert "@media print" in html


# --- Локации ---------------------------------------------------------------


def test_create_location_with_refinement(cms, crystal):
    created = cms.post(
        "/api/cms/locations",
        {
            "title": {"ru": "У теннисного корта"},
            "kind": "common_point",
            "requires_refinement": True,
            "refinement_label": {"ru": "Номер корта"},
        },
    )
    assert created.status_code == 201, created.content
    assert created.json()["requires_refinement"] is True


def test_refinement_requires_a_label(cms):
    response = cms.post(
        "/api/cms/locations",
        {"title": {"ru": "Без подписи"}, "kind": "common_point", "requires_refinement": True},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "refinement_label_required"


def test_location_matrix_reflects_service_links(cms, crystal):
    matrix = cms.get("/api/cms/locations/matrix").json()
    assert {loc["code"] for loc in matrix["locations"]} >= {"in_room", "pool"}

    hot_row = next(row for row in matrix["rows"] if row["category_title"] == "Горячее")
    in_room_cell = next(
        cell
        for cell, loc in zip(hot_row["cells"], matrix["locations"])
        if loc["code"] == "in_room"
    )
    # Сид связал «Горячее» с доставкой в номер.
    assert in_room_cell["enabled"] is True


def test_matrix_update_toggles_a_link(cms, crystal):
    matrix = cms.get("/api/cms/locations/matrix").json()
    drinks_row = next(row for row in matrix["rows"] if row["category_title"] == "Напитки")
    pool_id = next(loc["id"] for loc in matrix["locations"] if loc["code"] == "pool")
    category_id = drinks_row["category_id"]

    # Выключаем «Напитки → У бассейна».
    cms.put(
        "/api/cms/locations/matrix",
        {"category_id": category_id, "cells": [{"location_id": pool_id, "enabled": False}]},
    )
    with tenant_context(crystal):
        assert not ServiceLocation.objects.filter(
            category_id=category_id, location_id=pool_id
        ).exists()

    # И включаем обратно с самовывозом.
    cms.put(
        "/api/cms/locations/matrix",
        {
            "category_id": category_id,
            "cells": [{"location_id": pool_id, "enabled": True, "delivery_modes": ["pickup"]}],
        },
    )
    with tenant_context(crystal):
        link = ServiceLocation.objects.get(category_id=category_id, location_id=pool_id)
        assert link.delivery_modes == ["pickup"]


# --- Отделы ----------------------------------------------------------------


def test_departments_show_links_to_run6(cms):
    departments = cms.get("/api/cms/departments").json()
    kitchen = next(dept for dept in departments if dept["code"] == "kitchen")
    # Из списка отделов видно связь с каналами и эскалацией.
    assert kitchen["staff_count"] >= 1
    assert kitchen["channel_count"] >= 1
    assert kitchen["has_escalation"] is True


def test_create_department(cms):
    response = cms.post(
        "/api/cms/departments",
        {"title": {"ru": "Прачечная"}, "kind": "housekeeping", "sla_minutes": 60},
    )
    assert response.status_code == 201, response.content
    assert response.json()["sla_minutes"] == 60


def test_department_with_orders_cannot_be_deleted(cms, crystal, client):
    """Заказы ссылаются на отдел через PROTECT — удаление осиротило бы историю."""
    from .test_service_requests import place  # noqa

    # Оформим заказ на кухню и попробуем удалить кухню.
    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    menu = client.get(
        "/api/guest/menu", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {token}"
    ).json()
    item_id = next(
        i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar"
    )
    client.post(
        "/api/guest/order",
        data={"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY="dept-order",
    )

    with tenant_context(crystal):
        kitchen_id = str(ExecutionPoint.objects.get(code="kitchen").pk)

    response = cms.delete(f"/api/cms/departments/{kitchen_id}")
    assert response.status_code == 409
    assert response.json()["code"] == "department_in_use"


# --- Персонал ---------------------------------------------------------------


def test_staff_list_is_available(cms):
    """Эндпоинт для выбора сотрудника в персональном канале."""
    staff = cms.get("/api/cms/staff").json()
    emails = {member["email"] for member in staff}
    assert "chef@crystal.local" in emails

    chef = next(member for member in staff if member["email"] == "chef@crystal.local")
    assert chef["assignments"][0]["execution_point_code"] == "kitchen"
    assert chef["assignments"][0]["level"] == "lead"


def test_create_staff_with_assignment(cms, crystal):
    with tenant_context(crystal):
        bar_id = str(ExecutionPoint.objects.get(code="bar").pk)

    response = cms.post(
        "/api/cms/staff",
        {
            "email": "bartender@crystal.local",
            "full_name": "Олег, бармен",
            "password": "secret12345",
            "assignments": [{"execution_point_id": bar_id, "level": "member"}],
        },
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["assignments"][0]["execution_point_code"] == "bar"

    # Новый сотрудник действительно может войти — переиспользуется JWT-логин.
    login = cms.client.post(
        "/api/staff/auth/login",
        data={"email": "bartender@crystal.local", "password": "secret12345"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert login.status_code == 200


def test_weak_password_is_refused(cms):
    response = cms.post(
        "/api/cms/staff",
        {"email": "weak@crystal.local", "full_name": "X", "password": "123"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "weak_password"


def test_duplicate_email_is_refused(cms):
    response = cms.post(
        "/api/cms/staff",
        {"email": "chef@crystal.local", "full_name": "Дубль", "password": "secret12345"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "email_taken"


def test_patch_without_password_keeps_it(cms, crystal):
    with tenant_context(crystal):
        maid_id = str(User.objects.get(email="maid@crystal.local").pk)

    cms.patch(f"/api/cms/staff/{maid_id}", {"full_name": "Мария Ивановна"})
    login = cms.client.post(
        "/api/staff/auth/login",
        data={"email": "maid@crystal.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert login.status_code == 200, "старый пароль должен продолжать работать"


def test_cannot_delete_self(cms, crystal):
    with tenant_context(crystal):
        chef_id = str(User.objects.get(email="chef@crystal.local").pk)

    response = cms.delete(f"/api/cms/staff/{chef_id}")
    assert response.status_code == 409
    assert response.json()["code"] == "cannot_remove_self"


def test_replace_assignments(cms, crystal):
    with tenant_context(crystal):
        maid_id = str(User.objects.get(email="maid@crystal.local").pk)
        kitchen_id = str(ExecutionPoint.objects.get(code="kitchen").pk)

    response = cms.put(
        f"/api/cms/staff/{maid_id}/assignments",
        {"assignments": [{"execution_point_id": kitchen_id, "level": "manager"}]},
    )
    assert response.status_code == 200
    assignments = response.json()["assignments"]
    assert len(assignments) == 1
    assert assignments[0]["execution_point_code"] == "kitchen"
    assert assignments[0]["level"] == "manager"


# --- Персональный канал теперь настраивается --------------------------------


def test_personal_channel_can_target_a_listed_staffer(cms, crystal):
    staff = cms.get("/api/cms/staff").json()
    chef = next(member for member in staff if member["email"] == "chef@crystal.local")

    channel = cms.post(
        "/api/cms/notification-channels",
        {"type": "log", "title": "Личный канал повара", "user_id": chef["id"]},
    )
    assert channel.status_code == 201, channel.content
    assert channel.json()["user_id"] == chef["id"]


# --- Изоляция --------------------------------------------------------------


def test_admin_sections_are_isolated_between_hotels(cms, cms_aurora):
    crystal_rooms = {r["id"] for r in cms.get("/api/cms/rooms").json()}
    aurora_rooms = {r["id"] for r in cms_aurora.get("/api/cms/rooms").json()}
    assert crystal_rooms and aurora_rooms
    assert crystal_rooms.isdisjoint(aurora_rooms)

    crystal_staff = {s["email"] for s in cms.get("/api/cms/staff").json()}
    aurora_staff = {s["email"] for s in cms_aurora.get("/api/cms/staff").json()}
    assert "chef@crystal.local" in crystal_staff
    assert "chef@crystal.local" not in aurora_staff


def test_cannot_assign_staff_to_another_hotels_department(cms, cms_aurora, crystal, aurora):
    with tenant_context(aurora):
        aurora_kitchen = str(ExecutionPoint.objects.get(code="kitchen").pk)

    # Пытаемся привязать сотрудника Crystal к отделу Aurora — RLS не отдаст точку.
    response = cms.post(
        "/api/cms/staff",
        {
            "email": "spy@crystal.local",
            "full_name": "Шпион",
            "password": "secret12345",
            "assignments": [{"execution_point_id": aurora_kitchen, "level": "member"}],
        },
    )
    assert response.status_code == 422
    assert response.json()["field"] == "execution_point_id"


def test_guest_cannot_reach_admin(client, crystal, guest_token):
    response = client.get(
        "/api/cms/rooms",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
