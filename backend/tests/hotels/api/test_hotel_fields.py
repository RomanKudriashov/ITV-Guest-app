"""
Поля отеля, которые выбирают из списка, — проверка на сервере (партия 54).

Форма NaviRoom Control теперь даёт выбор, но список на экране — подсказка, а
не охрана. Каждая проверка ниже — укус: на прежнем коде сервер принимал эти
значения молча (пояс с опечаткой становился UTC, «XYZ» — валютой, «de» —
языком «DE», «admin» — отелем, недоступным по адресу).
"""

from __future__ import annotations

import json

import pytest
from django.conf import settings

from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel

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
                f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kw
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def _create(api, **override):
    body = {
        "subdomain": "fieldcheck",
        "name": "Проверка полей",
        "admin_email": "owner@fieldcheck.test",
        "timezone": "Europe/Moscow",
        "currency": "RUB",
        "languages": ["ru", "en"],
        "origin": "test",
    }
    body.update(override)
    return api("post", "/hotels", body)


@pytest.mark.parametrize(
    ("override", "field", "code"),
    [
        ({"timezone": "Europe/Moskow"}, "timezone", "timezone_unknown"),
        ({"timezone": "UTC+3"}, "timezone", "timezone_unknown"),
        ({"currency": "XYZ"}, "currency", "currency_unknown"),
        ({"currency": "RUBL"}, "currency", "currency_unknown"),
        ({"languages": ["ru", "de"]}, "languages", "language_unsupported"),
        ({"subdomain": "admin"}, "subdomain", "subdomain_reserved"),
        ({"subdomain": "control"}, "subdomain", "subdomain_reserved"),
        ({"subdomain": "ab"}, "subdomain", "subdomain_format"),
        ({"subdomain": "bad_name"}, "subdomain", "subdomain_format"),
        ({"subdomain": "-edge"}, "subdomain", "subdomain_format"),
        ({"subdomain": "x" * 31}, "subdomain", "subdomain_format"),
        ({"admin_email": "nobody"}, "admin_email", "email_invalid"),
        ({"admin_email": "a@b"}, "admin_email", "email_invalid"),
    ],
)
def test_create_rejects_what_the_list_would_not_offer(api, override, field, code):
    """УКУС. Неверное значение — 422 с кодом и полем; отеля не появляется."""
    resp = _create(api, **override)
    assert resp.status_code == 422, resp.content
    body = resp.json()
    assert body["code"] == code
    assert body["field"] == field
    assert not Hotel.objects.filter(subdomain="fieldcheck").exists()


def test_create_accepts_lowercase_currency_as_its_iso_code(api):
    """«rub» — это RUB, а не новая валюта: код приводится, а не отвергается."""
    resp = _create(api, currency="rub")
    assert resp.status_code == 201, resp.content
    assert Hotel.objects.get(subdomain="fieldcheck").currency == "RUB"


def test_profile_patch_rejects_unknown_timezone_and_currency(api):
    """УКУС. Профиль писал пояс и валюту как есть — теперь тот же отказ, что при создании."""
    hotel = provision_hotel(subdomain="patchfields", name="П", admin_email="p@patch.test").hotel
    bad_tz = api("patch", f"/hotels/{hotel.pk}", {"timezone": "Mars/Olympus"})
    assert bad_tz.status_code == 422 and bad_tz.json()["code"] == "timezone_unknown"
    bad_cur = api("patch", f"/hotels/{hotel.pk}", {"currency": "XYZ"})
    assert bad_cur.status_code == 422 and bad_cur.json()["code"] == "currency_unknown"
    good = api("patch", f"/hotels/{hotel.pk}", {"timezone": "Asia/Vladivostok", "currency": "usd", "confirm": ["timezone", "currency", "currency_minor_units"]})
    assert good.status_code == 200, good.content
    hotel.refresh_from_db()
    assert (hotel.timezone, hotel.currency) == ("Asia/Vladivostok", "USD")


def test_subdomain_check_answers_format_reserved_taken_and_free(api):
    """УКУС. Проверка «свободен» на ходу — тем же порядком, что и создание."""
    provision_hotel(subdomain="takenone", name="З", admin_email="t@taken.test")
    answers = {
        value: api("get", f"/reference/subdomain-check?value={value}").json()["code"]
        for value in ("ab", "admin", "takenone", "freeone")
    }
    assert answers == {
        "ab": "subdomain_format",
        "admin": "subdomain_reserved",
        "takenone": "hotel_exists",
        "freeone": None,
    }


def test_reference_lists_come_from_the_same_source_as_the_check(api):
    """Списки формы — те же, по которым проверяет сервер: экран и охрана не расходятся."""
    ref = api("get", "/reference/hotel-fields").json()
    assert "Europe/Moscow" in ref["timezones"]
    assert {"code": "JPY", "minor_units": 0} in ref["currencies"]
    assert ref["languages"] == list(settings.SUPPORTED_LANGUAGES)
    assert {"admin", "control", "api", "www", "static"} <= set(ref["subdomain"]["reserved"])


def test_reserved_names_survive_an_explicit_env_list():
    """
    УКУС. Стенд держит свой список в `.env` — раньше он ЗАМЕНЯЛ базовый, и
    новые запреты (control) туда бы не попали. Теперь окружение только добавляет.
    """
    assert {"control", "admin", "static"} <= settings.GUEST_APP_RESERVED_SUBDOMAINS


def test_group_rule_cities_are_the_fleet_cities(api):
    """Город для правила группы — из городов отелей, на всех их языках."""
    hotel = provision_hotel(subdomain="citycheck", name="Г", admin_email="c@city.test").hotel
    Hotel.objects.filter(pk=hotel.pk).update(city={"ru": "Гроздовск", "en": "Grozdovsk"})
    cities = api("get", "/reference/cities").json()["cities"]
    assert {"Гроздовск", "Grozdovsk"} <= set(cities)
