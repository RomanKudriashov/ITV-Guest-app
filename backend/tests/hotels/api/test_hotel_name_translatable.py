"""
Название отеля переводится, как и всё остальное на витрине.

Раньше `Hotel.name` был обычной строкой — одной на четыре языка, — и китайский
гость читал в шапке «Отель „Кристалл“». Имя собственное оставаться как есть и
должно: так его пишут на вывеске и в картах. Переводится слово ВОКРУГ него.

Проверяется три вещи: язык доезжает до гостя, оператор может это править, и
старые данные пережили переезд поля из varchar в jsonb.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db

NAMES = {
    "ru": "Отель «Кристалл»",
    "en": "Crystal Hotel",
    "ar": "فندق Crystal",
    "zh": "Crystal 酒店",
}


def _set_name(hotel: Hotel, value: dict) -> None:
    with tenant_context(hotel):
        Hotel.objects.filter(pk=hotel.pk).update(name=value)


def _guest_hotel_block(client, hotel: Hotel, language: str) -> dict:
    session = client.post(
        "/api/v1/guest/session",
        data={"room_number": "305", "language": language},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert session.status_code == 200, session.content
    token = session.json()["token"]
    response = client.get(
        f"/api/v1/guest/home?lang={language}",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert response.status_code == 200, response.content
    return response.json()["hotel"]


@pytest.mark.parametrize("language", ["ru", "en", "ar", "zh"])
def test_guest_sees_the_name_in_their_own_language(client, crystal, language):
    _set_name(crystal, NAMES)
    assert _guest_hotel_block(client, crystal, language)["name"] == NAMES[language]


def test_missing_language_falls_back_to_the_hotel_default(client, crystal):
    """
    Незаполненный язык — не пустая шапка.

    Отель мог не перевести название, и это нормальное состояние: гость увидит
    язык отеля по умолчанию, а не пустоту на месте имени.
    """
    _set_name(crystal, {"ru": NAMES["ru"]})
    assert _guest_hotel_block(client, crystal, "zh")["name"] == NAMES["ru"]


def test_operator_edits_the_name_and_the_guest_sees_it(cms, client, crystal):
    payload = cms.get("/api/v1/cms/home-settings").json()
    assert "name" in payload, "название обязано отдаваться туда же, где правится"

    saved = cms.put("/api/v1/cms/home-settings", {**payload, "name": NAMES})
    assert saved.status_code == 200, saved.content

    assert _guest_hotel_block(client, crystal, "zh")["name"] == NAMES["zh"]


def test_empty_name_is_refused(cms, crystal):
    """Отель без названия — пустая шапка у гостя, и заметит это гость."""
    payload = cms.get("/api/v1/cms/home-settings").json()

    refused = cms.put("/api/v1/cms/home-settings", {**payload, "name": {"ru": "   "}})
    assert refused.status_code == 422, refused.content
    assert refused.json()["field"] == "name"

    with tenant_context(crystal):
        crystal.refresh_from_db()
    assert crystal.name, "отказ не должен стирать то, что было"


def test_old_string_names_survived_the_migration(crystal):
    """
    Переезд varchar → jsonb не потерял ни одного названия.

    Миграция кладёт старую строку в язык отеля по умолчанию. Здесь это
    закреплено на фикстуре: у отеля есть название и оно есть на его языке.
    """
    with tenant_context(crystal):
        crystal.refresh_from_db()
    assert isinstance(crystal.name, dict), "поле обязано стать словарём"
    assert (crystal.name.get(crystal.default_language) or "").strip(), (
        "название на языке отеля по умолчанию потерялось при переезде"
    )


def test_seed_registry_fills_four_languages_idempotently(crystal):
    """Реестр дописывает недостающее и не трогает уже заполненное."""
    from apps.hotels.seed_translations import fill_translations

    _set_name(crystal, {"ru": NAMES["ru"]})

    with tenant_context(crystal):
        fill_translations()
        crystal.refresh_from_db()
        first = dict(crystal.name)
        # Второй прогон обязан ничего не менять: сид доукомплектовывает,
        # а не переписывает.
        fill_translations()
        crystal.refresh_from_db()

    assert set(first) >= {"ru", "en", "ar", "zh"}
    assert crystal.name == first
