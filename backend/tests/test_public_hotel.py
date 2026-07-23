"""
Публичный бренд отеля по поддомену — экран входа темизируется до сессии.
Контракт — guest-api-contract §0.
"""

from __future__ import annotations

import pytest

from .conftest import host_for

pytestmark = pytest.mark.django_db


def test_public_hotel_returns_brand_without_auth(client, crystal):
    resp = client.get("/api/guest/hotel", HTTP_HOST=host_for(crystal))
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["subdomain"] == "crystal"
    assert body["name"]
    # Токены бренда — чтобы вход был тёмным/фирменным ещё до аутентификации.
    assert body["theme"]
    assert body["default_language"]


def test_public_hotel_unknown_subdomain_not_ok(client):
    resp = client.get("/api/guest/hotel", HTTP_HOST="nosuchhotel.guest.localhost")
    assert resp.status_code != 200
