"""Общее для проверок баннера: гость с сессией и быстрый способ завести баннер."""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule
from apps.promo.models import Banner
from tests.conftest import host_for


@pytest.fixture(autouse=True)
def _marketing_on(crystal):
    """Раздел живёт за модулем маркетинга — включаем его явно, а не надеемся."""
    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.MARKETING,
            defaults={"is_enabled": True, "intent": "on"},
        )
    return crystal


@pytest.fixture
def guest(client, crystal):
    """Фабрика гостей: каждый вызов — НОВАЯ сессия, как новое устройство."""

    def make(room="201", language="ru"):
        token = client.post(
            "/api/guest/session",
            data={"room_number": room, "language": language},
            content_type="application/json",
            HTTP_HOST=host_for(crystal),
        ).json()["token"]

        def call(path, method="get", body=None, **extra):
            kwargs = {
                "HTTP_HOST": host_for(crystal),
                "HTTP_AUTHORIZATION": f"Bearer {token}",
                "HTTP_ACCEPT_LANGUAGE": language,
                **extra,
            }
            if method == "post":
                return client.post(path, data=body or {}, content_type="application/json", **kwargs)
            return client.get(path, **kwargs)

        return call

    return make


@pytest.fixture
def banner(crystal):
    """Простой активный баннер без правил: показывается всем и всегда."""

    def make(**fields):
        with tenant_context(crystal):
            return Banner.objects.create(
                hotel_id=crystal.id,
                **{"name": "Спа-акция", "title": {"ru": "Спа со скидкой"}, **fields},
            )

    return make
