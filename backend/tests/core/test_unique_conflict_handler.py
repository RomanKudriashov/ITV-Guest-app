"""
Нарушение уникальности отвечает 409, а не пятисоткой.

Уникальные индексы не знают про `deleted_at`: мягко удалённая строка занимает
ключ наравне с живой. Восемь проверенных ручек падали на этом необъяснённым
`IntegrityError`, и оператор читал «платформа сломалась» там, где надо было
прочесть «код занят».

Точка одна и общая — иначе следующая ручка появится без обработки и повторит
ту же пятисотку. Поэтому здесь проверяется не список ручек, а слой.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

BASE_HOST = "guest.localhost"
OWNER = ("root@platform.test", "platform12345")


@pytest.fixture
def hotel():
    return provision_hotel(
        subdomain="uniq", name="Уникальный", admin_email="admin@uniq.test",
        admin_password="hotel-admin-12345",
    ).hotel


@pytest.fixture
def cms(client, hotel):
    token = client.post(
        "/api/v1/staff/auth/login",
        data=json.dumps({"email": "admin@uniq.test", "password": "hotel-admin-12345"}),
        content_type="application/json", HTTP_HOST=host_for(hotel),
    ).json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": host_for(hotel), "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/cms{path}", data=json.dumps(body),
                content_type="application/json", **kw)
        return getattr(client, method)(f"/api/v1/cms{path}", **kw)

    return call


@pytest.fixture
def platform_api(client):
    ensure_platform_admin(email=OWNER[0], password=OWNER[1])
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": OWNER[0], "password": OWNER[1]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw)
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


# --- Главное: 409 вместо 500 ------------------------------------------------


def test_deleted_category_code_answers_409_not_500(cms):
    """
    ГЛАВНОЕ. Удалить раздел меню и завести с тем же кодом — внятный отказ.

    Пятисотка здесь была бы не «строгостью», а дезинформацией: раздела в
    списке нет, код на вид свободен, а система молча ломается.
    """
    created = cms("post", "/categories", {"title": {"ru": "Завтрак"}, "code": "breakfast"})
    assert created.status_code == 201, created.content
    assert cms("delete", f"/categories/{created.json()['id']}").status_code == 200

    again = cms("post", "/categories", {"title": {"ru": "Завтрак снова"}, "code": "breakfast"})

    assert again.status_code == 409, f"ожидался отказ, получено {again.status_code}"
    body = again.json()
    assert body["code"] == "unique_conflict"
    # Текст НАЗЫВАЕТ занятое и объясняет, почему свободное на вид — занято.
    assert "breakfast" in body["detail"], body["detail"]
    assert "удал" in body["detail"].lower(), body["detail"]
    assert body["field"] == "code"
    assert body["blocked_by"] == "deleted"


def test_live_row_conflict_says_simply_occupied(cms):
    """Занято живой записью — про удаление ни слова: его тут нет."""
    cms("post", "/categories", {"title": {"ru": "Обед"}, "code": "lunch"})

    again = cms("post", "/categories", {"title": {"ru": "Обед 2"}, "code": "lunch"})

    assert again.status_code == 409, again.content
    body = again.json()
    assert body["blocked_by"] == "active"
    assert "удал" not in body["detail"].lower(), body["detail"]
    assert "lunch" in body["detail"]


@pytest.mark.parametrize(
    ("path", "body", "key"),
    [
        ("/locations", {"title": {"ru": "Проба"}, "code": "spa"}, "spa"),
        ("/allergens", {"title": {"ru": "Проба"}, "code": "nuts_own"}, "nuts_own"),
        ("/markers", {"title": {"ru": "Проба"}, "code": "vegan_own"}, "vegan_own"),
    ],
)
def test_the_same_holds_for_handles_nobody_taught(cms, path, body, key):
    """
    Ни одна из этих ручек про уникальность не знает — и всё равно отвечает
    отказом. В этом и смысл общей точки.
    """
    created = cms("post", path, body)
    assert created.status_code in (200, 201), created.content
    cms("delete", f"{path}/{created.json()['id']}")

    again = cms("post", path, body)

    assert again.status_code == 409, f"{path}: {again.status_code} {again.content[:200]}"
    assert key in again.json()["detail"]


# --- Что обработчик трогать не должен ---------------------------------------


def test_three_handles_keep_their_own_words(cms, hotel, client):
    """
    Room, Service и почта сотрудника спрашивают `all_objects` ДО вставки и
    отвечают своим текстом. Общий обработчик не должен их подменять: их отказ
    точнее — он знает, о чём речь.
    """
    room = cms("post", "/rooms", {"number": "701"})
    cms("delete", f"/rooms/{room.json()['id']}")
    room_again = cms("post", "/rooms", {"number": "701"})
    assert room_again.status_code == 409
    assert room_again.json()["code"] == "room_exists", room_again.json()

    service = cms("post", "/services", {"public_name": {"ru": "Спа"}, "code": "spa_svc"})
    cms("delete", f"/services/{service.json()['id']}")
    service_again = cms("post", "/services", {"public_name": {"ru": "Спа"}, "code": "spa_svc"})
    assert service_again.status_code == 409
    assert service_again.json()["code"] == "service_exists", service_again.json()

    staff = cms("post", "/staff", {
        "email": "cook@uniq.test", "password": "staff-12345", "full_name": "Повар"})
    cms("delete", f"/staff/{staff.json()['id']}")
    staff_again = cms("post", "/staff", {
        "email": "cook@uniq.test", "password": "staff-12345", "full_name": "Повар"})
    assert staff_again.status_code == 409
    assert staff_again.json()["code"] == "email_taken", staff_again.json()


def test_other_integrity_errors_stay_server_errors(client, hotel):
    """
    Внешний ключ и NOT NULL — дефекты кода, а не выбор оператора. Вежливый 409
    их бы спрятал от того, кто чинит.
    """
    from django.db import IntegrityError

    from apps.core.db_errors import unique_conflict

    with tenant_context(hotel):
        from apps.catalog.models import Item

        try:
            # Категории с таким id нет: нарушение внешнего ключа.
            Item.objects.create(
                hotel_id=hotel.pk, category_id="00000000-0000-0000-0000-000000000000",
                title={"ru": "Ничей"}, code="orphan",
            )
        except IntegrityError as exc:
            assert unique_conflict(exc) is None, "чужая ошибка разобрана как уникальность"
        else:
            pytest.fail("нарушение внешнего ключа не сработало — проба бессмысленна")


# --- Платформенный уровень --------------------------------------------------


def test_platform_handles_are_covered_too(platform_api):
    """Шаблон онбординга: то же удаление, тот же повтор, тот же отказ."""
    made = platform_api("post", "/templates", {"code": "boutique", "name": {"ru": "Бутик"}})
    assert made.status_code in (200, 201), made.content

    from apps.core.context import platform_scope
    from apps.hotels.models import OnboardingTemplate

    with platform_scope():
        OnboardingTemplate.objects.using("platform").filter(code="boutique").delete()

    again = platform_api("post", "/templates", {"code": "boutique", "name": {"ru": "Бутик 2"}})
    assert again.status_code == 409, f"{again.status_code} {again.content[:200]}"
    assert "boutique" in again.json()["detail"]
