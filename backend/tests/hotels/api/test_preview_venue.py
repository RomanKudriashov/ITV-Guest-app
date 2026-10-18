"""
«ПОКАЗ» В БРЕНДЕ: ЗАВЕДЕНИЕ И ЯЗЫК (партия 58в).

1. По умолчанию — первое заведение С ПОЗИЦИЯМИ: у Метрополя первым стоит
   «Ресепшен» без меню, и показ открывался пустым «Услуг пока нет».
2. Язык данных — `?lang=` показа, а не `Accept-Language` браузера: панель на
   русском показывала «Crystal Hotel» и «Lobby bar».
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_default_venue_is_the_first_with_items(cms, crystal):
    options = cms.get("/api/cms/brand/preview?screen=venue_options").json()["venues"]
    assert options, "у демо-отеля нет гостевых заведений"
    first_with_items = next(row["code"] for row in options if row["items"])
    # Первое по порядку делаем пустым — как «Ресепшен» у Метрополя.
    with tenant_context(crystal):
        point = ExecutionPoint.objects.create(code="e2e-empty-reception", title={"ru": "Пустой ресепшен"})
        Service.objects.filter(is_guest_facing=True).update(sort_order=10)
        empty = Service.objects.create(
            code="e2e-empty-reception",
            execution_point=point,
            public_name={"ru": "Пустой ресепшен", "en": "Empty reception"},
            is_active=True,
            is_guest_facing=True,
            sort_order=0,
        )
    try:
        options = cms.get("/api/cms/brand/preview?screen=venue_options").json()["venues"]
        assert options[0]["code"] == "e2e-empty-reception" and options[0]["items"] == 0
        catalog = cms.get("/api/cms/brand/preview?screen=catalog").json()
        assert catalog["venue"]["code"] == first_with_items
    finally:
        with tenant_context(crystal):
            Service.all_objects.filter(pk=empty.pk).delete()
            ExecutionPoint.objects.filter(pk=point.pk).delete()


def test_chosen_venue_is_respected(cms):
    options = cms.get("/api/cms/brand/preview?screen=venue_options").json()["venues"]
    last = options[-1]["code"]
    catalog = cms.get(f"/api/cms/brand/preview?screen=catalog&point={last}").json()
    assert catalog["venue"]["code"] == last


def test_preview_data_follows_lang_not_accept_language(cms):
    ru = cms.get("/api/cms/brand/preview?screen=hotel&lang=ru", HTTP_ACCEPT_LANGUAGE="en-US").json()
    en = cms.get("/api/cms/brand/preview?screen=hotel&lang=en", HTTP_ACCEPT_LANGUAGE="ru-RU").json()
    assert ru["name"] != en["name"], "язык показа не дошёл до данных отеля"


def test_venues_screen_has_the_guest_shape(cms, client, crystal, guest_token):
    """Показ «Заведения» — та же форма, что у гостя: `venues` — список, а не ещё один словарь."""
    from tests.conftest import host_for

    preview = cms.get("/api/cms/brand/preview?screen=venues&group=restaurants&lang=ru").json()
    real = client.get(
        "/api/guest/venues?group=restaurants",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()
    assert isinstance(preview["venues"], list) and preview["venues"], "показ получил пустой или вложенный список"
    assert set(preview) == set(real)
