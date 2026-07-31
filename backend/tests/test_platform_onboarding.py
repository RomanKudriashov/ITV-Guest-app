"""
Шаблоны онбординга, системный справочник, экспорт и офбординг (R6 C9–C10).

Ключевые свойства, которые здесь защищаются:
  * шаблон задаёт СТАРТ и не остаётся поводком — правка задним числом не
    переписывает уже заведённые отели;
  * выгрузка не отдаёт секретов;
  * удаление данных необратимо, поэтому требует двух шагов и ввода поддомена.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel, OnboardingTemplate, Service, SystemDictionaryEntry
from apps.hotels.provisioning import ensure_platform_admin, provision_hotel

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
EMAIL = "root@platform.test"
PASSWORD = "platform12345"


@pytest.fixture
def api(client):
    ensure_platform_admin(email=EMAIL, password=PASSWORD)
    resp = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    token = resp.json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


# --- Шаблоны ---------------------------------------------------------------


def test_seed_fills_empty_registries_once(api):
    assert OnboardingTemplate.objects.count() == 0
    first = api("get", "/templates").json()
    assert {entry["code"] for entry in first} >= {"restaurant_hotel", "resort", "blank"}

    # Повторный заход ничего не дублирует и не перезаписывает.
    api("patch", f"/templates/{first[0]['id']}", {"is_active": False})
    again = api("get", "/templates").json()
    assert len(again) == len(first)
    assert next(e for e in again if e["id"] == first[0]["id"])["is_active"] is False


def test_hotel_created_from_template_gets_services_and_tariff(api):
    api("get", "/templates")  # засеять реестр
    resp = api("post", "/hotels", {
        "subdomain": "fromtpl", "name": "Из шаблона",
        "admin_email": "a@fromtpl.test", "template": "resort",
    })
    assert resp.status_code == 201, resp.content
    body = resp.json()
    assert body["template"] == "resort"
    assert len(body["services"]) == 6

    hotel = Hotel.objects.get(subdomain="fromtpl")
    assert hotel.tariff == "resort"
    with tenant_context(hotel):
        types = set(Service.objects.values_list("type", flat=True))
    assert {"spa", "pool", "excursions"} <= types


def test_editing_a_template_does_not_touch_hotels_already_created(api):
    api("get", "/templates")
    api("post", "/hotels", {
        "subdomain": "early", "name": "Ранний",
        "admin_email": "a@early.test", "template": "restaurant_hotel",
    })
    hotel = Hotel.objects.get(subdomain="early")
    with tenant_context(hotel):
        before = set(Service.objects.values_list("code", flat=True))

    template = next(e for e in api("get", "/templates").json() if e["code"] == "restaurant_hotel")
    api("patch", f"/templates/{template['id']}", {
        "services": [{"type": "spa", "name": {"ru": "СПА"}}], "tariff": "resort",
    })

    # Шаблон изменился, отель — нет. Иначе платформа могла бы молча переписать
    # чужой отель задним числом.
    with tenant_context(hotel):
        after = set(Service.objects.values_list("code", flat=True))
    assert after == before
    assert Hotel.objects.get(subdomain="early").tariff == "business"


def test_blank_template_creates_no_services(api):
    api("get", "/templates")
    body = api("post", "/hotels", {
        "subdomain": "blankone", "name": "Пустой",
        "admin_email": "a@blankone.test", "template": "blank",
    }).json()
    assert body["services"] == []


def test_unknown_template_is_rejected(api):
    api("get", "/templates")
    resp = api("post", "/hotels", {
        "subdomain": "badtpl", "name": "Плохой",
        "admin_email": "a@badtpl.test", "template": "no-such-template",
    })
    assert resp.status_code == 404


# --- Системный справочник --------------------------------------------------


def test_system_dictionary_seeds_and_accepts_new_entries(api):
    entries = api("get", "/dictionaries").json()
    allergens = [e for e in entries if e["kind"] == "allergen"]
    # Четырнадцать обязательных аллергенов — требование закона, а не наш выбор.
    assert len(allergens) == 14

    added = api("put", "/dictionaries", {
        "kind": "allergen", "code": "sesame_oil", "title": {"ru": "Кунжутное масло"},
    })
    assert added.status_code == 200
    assert SystemDictionaryEntry.objects.filter(kind="allergen", code="sesame_oil").exists()


def test_dictionary_rejects_unknown_kind(api):
    api("get", "/dictionaries")
    resp = api("put", "/dictionaries", {"kind": "colours", "code": "red", "title": {"ru": "Красный"}})
    assert resp.status_code == 422


# --- Экспорт ---------------------------------------------------------------


def test_export_returns_data_without_secrets(api):
    hotel = provision_hotel(
        subdomain="exporter", name="Выгрузка", admin_email="a@exporter.test"
    ).hotel

    resp = api("get", f"/hotels/{hotel.pk}/export")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("application/json")
    body = json.loads(resp.content.decode("utf-8"))

    assert body["hotel"]["subdomain"] == "exporter"
    assert "orders_meta" in body
    # Ни паролей, ни токенов: выгрузка не должна быть способом получить доступ.
    raw = resp.content.decode("utf-8")
    assert "password" not in raw and "token_hash" not in raw


# --- Офбординг -------------------------------------------------------------


def test_purge_requires_marking_first(api):
    hotel = provision_hotel(subdomain="hasty", name="Спешка", admin_email="a@hasty.test").hotel

    resp = api("post", f"/hotels/{hotel.pk}/purge", {"confirm_subdomain": "hasty"})
    assert resp.status_code == 422
    assert resp.json().get("code") == "not_marked"


def test_purge_requires_typing_the_subdomain(api):
    hotel = provision_hotel(subdomain="typeit", name="Ввод", admin_email="a@typeit.test").hotel
    api("post", f"/hotels/{hotel.pk}/offboard", {"reason": "расторжение договора"})

    wrong = api("post", f"/hotels/{hotel.pk}/purge", {"confirm_subdomain": "typo"})
    assert wrong.status_code == 422
    assert wrong.json().get("code") == "confirm_mismatch"
    # Данные на месте — ошибочное подтверждение ничего не стирает.
    with tenant_context(hotel):
        from apps.hotels.models import HotelLanguage

        assert HotelLanguage.objects.exists()


def test_marking_disables_the_hotel_and_can_be_undone(api):
    hotel = provision_hotel(subdomain="undoable", name="Обратимо", admin_email="a@undoable.test").hotel
    assert hotel.is_active

    api("post", f"/hotels/{hotel.pk}/offboard", {"reason": "переезд к другому вендору"})
    hotel.refresh_from_db()
    # Помеченный отель не должен принимать заказы, пока идёт офбординг.
    assert not hotel.is_active
    assert hotel.settings["offboarding"]["reason"]

    api("post", f"/hotels/{hotel.pk}/offboard", {"cancel": True})
    hotel.refresh_from_db()
    assert "offboarding" not in hotel.settings
    # Включение обратно — отдельное осознанное действие, а не побочный эффект.
    assert not hotel.is_active


def test_offboard_requires_a_reason(api):
    hotel = provision_hotel(subdomain="noreason", name="Без причины", admin_email="a@noreason.test").hotel
    assert api("post", f"/hotels/{hotel.pk}/offboard", {"reason": "   "}).status_code == 422


def test_purge_removes_data_but_keeps_the_hotel_row(api):
    hotel = provision_hotel(subdomain="gone", name="Ушедший", admin_email="a@gone.test").hotel
    api("post", f"/hotels/{hotel.pk}/offboard", {"reason": "расторжение"})

    resp = api("post", f"/hotels/{hotel.pk}/purge", {"confirm_subdomain": "gone"})
    assert resp.status_code == 200, resp.content
    removed = resp.json()["removed"]
    assert removed["languages"] > 0

    with tenant_context(hotel):
        from apps.hotels.models import HotelLanguage, Room

        assert not HotelLanguage.objects.exists()
        assert not Room.objects.exists()

    # Строка отеля остаётся: платформа обязана уметь ответить, что он был.
    hotel.refresh_from_db()
    assert hotel.subdomain == "gone"
    assert hotel.settings["offboarding"]["purged_at"]
