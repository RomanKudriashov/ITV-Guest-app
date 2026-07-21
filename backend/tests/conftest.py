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
