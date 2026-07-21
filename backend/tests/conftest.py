"""
Общие фикстуры.

Тесты ходят по реальному хосту-поддомену (crystal.guest.localhost), а не через
dev-заголовок: резолюция тенанта — часть того, что проверяется.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.core.context import clear_request_context, tenant_context
from apps.hotels.models import Hotel


@pytest.fixture(autouse=True)
def _clean_context():
    """Контекст тенанта не должен протекать между тестами — ни в питоне, ни в БД."""
    clear_request_context()
    yield
    clear_request_context()


@pytest.fixture
def seeded(db):
    """Два отеля из сида: рабочий демо-отель и второй — для проверки изоляции."""
    call_command("seed_demo_hotel", "--with-second-hotel", verbosity=0)
    return {
        "crystal": Hotel.objects.get(subdomain="crystal"),
        "aurora": Hotel.objects.get(subdomain="aurora"),
    }


@pytest.fixture
def crystal(seeded):
    return seeded["crystal"]


@pytest.fixture
def aurora(seeded):
    return seeded["aurora"]


def host_for(hotel: Hotel) -> str:
    return f"{hotel.subdomain}.guest.localhost"


@pytest.fixture
def guest_token(client, crystal):
    """Гостевая сессия в номере 201 демо-отеля."""
    response = client.post(
        "/api/guest/session",
        data={"room_number": "201", "language": "ru"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


@pytest.fixture
def in_crystal(crystal):
    with tenant_context(crystal):
        yield crystal


# --- CMS -------------------------------------------------------------------


def staff_token_for(client, hotel) -> str:
    response = client.post(
        "/api/staff/auth/login",
        data={"email": f"chef@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["access"]


class CmsClient:
    """
    Тонкая обёртка над тест-клиентом: подставляет хост отеля и JWT, чтобы
    тесты читались как список действий, а не как набор заголовков.
    """

    def __init__(self, client, hotel, token: str):
        self.client = client
        self.hotel = hotel
        self.token = token

    def _kwargs(self, extra: dict | None = None) -> dict:
        kwargs = {
            "HTTP_HOST": host_for(self.hotel),
            "HTTP_AUTHORIZATION": f"Bearer {self.token}",
        }
        kwargs.update(extra or {})
        return kwargs

    def get(self, path: str, **extra):
        return self.client.get(path, **self._kwargs(extra))

    def post(self, path: str, data=None, **extra):
        return self.client.post(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def patch(self, path: str, data=None, **extra):
        return self.client.patch(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def put(self, path: str, data=None, **extra):
        return self.client.put(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def delete(self, path: str, **extra):
        return self.client.delete(path, **self._kwargs(extra))

    def upload(self, path: str, files: dict, data: dict | None = None):
        return self.client.post(path, data={**(data or {}), **files}, **self._kwargs())


@pytest.fixture
def cms(client, crystal):
    return CmsClient(client, crystal, staff_token_for(client, crystal))


@pytest.fixture
def cms_aurora(client, aurora):
    return CmsClient(client, aurora, staff_token_for(client, aurora))


@pytest.fixture
def category_id(cms):
    """id категории «Горячее» демо-отеля."""
    tree = cms.get("/api/cms/categories").json()
    return next(node["id"] for node in tree if node["code"] == "hot")
