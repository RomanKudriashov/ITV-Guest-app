"""Заведение баннера в CMS: гейт модуля, проверки формы, карусель."""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule, RoomCategory, Service

pytestmark = pytest.mark.django_db


def _create(cms, **fields):
    return cms.post("/api/cms/banners", {"name": "Спа", **fields})


def test_the_section_is_closed_without_the_marketing_module(cms, crystal):
    """Гейт стоит на сервере: спрятать пункт меню значит не закрыть ничего."""
    with tenant_context(crystal):
        HotelModule.objects.filter(code=HotelModule.Code.MARKETING).update(
            is_enabled=False, intent=HotelModule.Intent.OFF
        )
    response = cms.get("/api/cms/banners")
    assert response.status_code == 403
    assert response.json()["code"] == "module_disabled"


def test_a_banner_is_created_and_read_back(cms):
    created = _create(cms, title={"ru": "Спа со скидкой"}, size="l", placement="bottom", priority=5)
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["size"] == "l" and body["placement"] == "bottom" and body["priority"] == 5
    assert body["stats"]["impressions"] == 0


def test_an_action_without_a_target_is_refused(cms):
    """Баннер, который никуда не ведёт, отель заметил бы по нулям, а не сразу."""
    refused = _create(cms, action="link")
    assert refused.status_code == 422
    assert refused.json()["code"] == "action_without_target"

    refused = _create(cms, action="venue")
    assert refused.status_code == 422

    refused = _create(cms, action="page")
    assert refused.status_code == 422


def test_a_venue_action_needs_a_real_venue(cms, crystal):
    refused = _create(cms, action="venue", action_service_id="00000000-0000-0000-0000-000000000000")
    assert refused.status_code == 422
    assert refused.json()["code"] == "service_not_found"

    with tenant_context(crystal):
        service = Service.objects.first()
    created = _create(cms, action="venue", action_service_id=str(service.pk))
    assert created.status_code == 201, created.content
    assert created.json()["action_service_id"] == str(service.pk)


def test_a_translatable_field_refuses_a_bare_string(cms):
    """
    Строка вместо карты переводов — та же поломка, что съела настройки главной
    в пункте 22: отель сохранял имя строкой, и форма молча падала на 422.

    Форму отбивает схема, ещё до сервиса. Сервис проверяет то же самое сам —
    он зовётся не только из формы (сиды, переносы данных), и на той дороге
    схемы нет.
    """
    refused = _create(cms, title="Спа со скидкой")
    assert refused.status_code == 422

    from apps.core.errors import ValidationError
    from apps.promo.services.admin import _as_map

    with pytest.raises(ValidationError) as caught:
        _as_map("Спа со скидкой", "title")
    assert caught.value.code == "bad_translation"


def test_room_categories_are_saved_and_checked(cms, crystal):
    with tenant_context(crystal):
        suite = RoomCategory.objects.get(code="suite")
    created = _create(cms, room_category_ids=[str(suite.pk)])
    assert created.status_code == 201, created.content
    assert created.json()["room_category_ids"] == [str(suite.pk)]

    refused = _create(cms, room_category_ids=["00000000-0000-0000-0000-000000000000"])
    assert refused.status_code == 422
    assert refused.json()["code"] == "category_not_found"


def test_a_foreign_hotel_category_is_not_accepted(cms, crystal, aurora):
    """Баннер одного отеля не сошлётся на справочник другого."""
    with tenant_context(aurora):
        foreign = RoomCategory.objects.create(hotel_id=aurora.id, code="foreign", title={"ru": "Чужая"})
    refused = _create(cms, room_category_ids=[str(foreign.pk)])
    assert refused.status_code == 422
    assert refused.json()["code"] == "category_not_found"


def test_the_carousel_has_a_ceiling(cms, crystal):
    from apps.media.models import MediaAsset

    banner_id = _create(cms).json()["id"]
    with tenant_context(crystal):
        assets = [
            MediaAsset.objects.create(
                hotel_id=crystal.id, kind=MediaAsset.Kind.BANNER, object_key=f"k{i}"
            )
            for i in range(11)
        ]
    for asset in assets[:10]:
        answer = cms.post(f"/api/cms/banners/{banner_id}/images", {"asset_id": str(asset.pk)})
        assert answer.status_code == 200, answer.content
    refused = cms.post(f"/api/cms/banners/{banner_id}/images", {"asset_id": str(assets[10].pk)})
    assert refused.status_code == 422
    assert refused.json()["code"] == "too_many_images"


def test_time_and_dates_take_plain_text(cms):
    created = _create(cms, starts_on="2026-09-01", ends_on="2026-09-30", time_from="22:00", time_to="06:00")
    assert created.status_code == 201, created.content
    body = created.json()
    assert body["time_from"] == "22:00" and body["time_to"] == "06:00"
    assert body["starts_on"] == "2026-09-01"

    refused = _create(cms, starts_on="01.09.2026")
    assert refused.status_code == 422
    assert refused.json()["code"] == "bad_date"


def test_a_banner_can_be_edited_and_removed(cms):
    banner_id = _create(cms).json()["id"]
    patched = cms.patch(f"/api/cms/banners/{banner_id}", {"priority": 9, "is_active": False})
    assert patched.status_code == 200, patched.content
    assert patched.json()["priority"] == 9 and patched.json()["is_active"] is False

    assert cms.delete(f"/api/cms/banners/{banner_id}").status_code == 204
    assert cms.get(f"/api/cms/banners/{banner_id}").status_code == 404
