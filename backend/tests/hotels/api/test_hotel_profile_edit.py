"""
Профиль отеля правится, и правка остаётся в журнале с значениями.

Журнал, где написано «изменено поле currency», через месяц не отвечает на
вопрос, ради которого его читают: с чего на что поменяли, и была ли это
ошибка. Поэтому в записи лежат «было» и «стало».
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

BASE_HOST = "guest.localhost"
OWNER = ("root@platform.test", "platform12345")


@pytest.fixture
def hotel():
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(
        subdomain="edited", name="Правимый", admin_email="a@edited.test",
        admin_password="x-12345",
    ).hotel


@pytest.fixture
def api(client):
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


def _updates(hotel) -> list[dict]:
    with tenant_context(hotel):
        return [
            row.payload
            for row in AuditLog.objects.filter(action="platform.hotel.updated").order_by("created_at")
        ]


def test_profile_edit_saves_every_field_the_form_offers(api, hotel):
    """Форма правит ровно то, что принимает ручка, — включая размерность валюты."""
    resp = api("patch", f"/hotels/{hotel.pk}", {
        "name": "Переименованный",
        "timezone": "Asia/Tokyo",
        "currency": "JPY",
        "currency_minor_units": 0,
        "languages": ["en", "ru"],
    })
    assert resp.status_code == 200, resp.content
    body = resp.json()

    assert body["timezone"] == "Asia/Tokyo"
    assert body["currency"] == "JPY"
    assert body["currency_minor_units"] == 0
    # Первый язык списка становится языком по умолчанию — это и есть способ
    # его задать сегодня.
    assert body["default_language"] == "en"
    assert [lang["code"] for lang in body["languages"]] == ["en", "ru"]


def test_currency_change_is_readable_a_month_later(api, hotel):
    """
    ГЛАВНОЕ ПРО ЖУРНАЛ. По записи видно, кто, когда, с чего и на что поменял.
    """
    api("patch", f"/hotels/{hotel.pk}", {"currency": "EUR", "currency_minor_units": 2})

    payload = _updates(hotel)[-1]
    assert "currency" in payload["fields"]
    assert payload["changes"]["currency"] == {"from": "RUB", "to": "EUR"}

    with tenant_context(hotel):
        row = AuditLog.objects.filter(action="platform.hotel.updated").latest("created_at")
    assert row.actor_id is not None, "без автора запись не отвечает на «кто»"


def test_language_change_lands_in_the_journal_too(api, hotel):
    """Языки меняются другой дорогой (через таблицу), и их тоже надо видеть."""
    api("patch", f"/hotels/{hotel.pk}", {"languages": ["ru", "en", "zh"]})

    payload = _updates(hotel)[-1]
    assert payload["changes"]["languages"]["to"] == ["ru", "en", "zh"]


def test_unchanged_fields_do_not_make_journal_noise(api, hotel):
    """
    Отправка того же значения — не изменение. Иначе журнал забивается
    записями «поменял валюту на ту же самую», и в нём тонет настоящее.
    """
    before = len(_updates(hotel))
    api("patch", f"/hotels/{hotel.pk}", {"currency": hotel.currency, "timezone": hotel.timezone})

    assert len(_updates(hotel)) == before


def test_read_only_role_cannot_edit(api, client, hotel):
    """Правка — право `write`. Роль «только чтение» получает отказ, а не тихий успех."""
    invited = api("post", "/team", {"email": "eyes@platform.test", "role": "read_only"}).json()
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": "eyes@platform.test", "password": invited["password"]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    ).json()["access"]

    resp = client.patch(
        f"/api/v1/platform/hotels/{hotel.pk}",
        data=json.dumps({"currency": "USD"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST, HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 403
    with platform_scope():
        assert Hotel.all_objects.using("platform").get(pk=hotel.pk).currency == "RUB"
