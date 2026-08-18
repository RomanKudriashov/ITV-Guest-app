"""
Фото точки исполнения (bounded-исключение C1): загрузка через медиапайплайн в
редакторе отдела и hero каталога из этого фото. Контракты — hotel-admin + guest.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.media.tasks import process_media_asset

from tests.conftest import host_for
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db


def _upload_ready(cms, crystal) -> str:
    """Грузим фото и доводим до status=ready через задачу пайплайна."""
    asset_id = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("venue.png", png_bytes(), content_type="image/png")},
        {"kind": "category"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    return asset_id


def _kitchen(cms):
    return next(s for s in cms.get("/api/cms/services").json()["items"] if s["code"] == "kitchen")


def test_department_image_upload_serializes_ready(cms, crystal):
    asset_id = _upload_ready(cms, crystal)
    patched = cms.patch(f"/api/cms/services/{_kitchen(cms)['id']}", {"image_id": asset_id})
    assert patched.status_code == 200, patched.content
    image = patched.json()["image"]
    assert image is not None
    assert image["status"] == "ready"
    assert image["url"]  # готовый webp-вариант


def test_department_image_can_be_cleared(cms, crystal):
    asset_id = _upload_ready(cms, crystal)
    kitchen_id = _kitchen(cms)["id"]
    cms.patch(f"/api/cms/services/{kitchen_id}", {"image_id": asset_id})
    cleared = cms.patch(f"/api/cms/services/{kitchen_id}", {"image_id": None})
    assert cleared.json()["image"] is None


def test_catalog_hero_image_comes_from_point_photo(client, cms, crystal, guest_token):
    def catalog():
        return client.get(
            "/api/guest/catalog?type=product",
            HTTP_HOST=host_for(crystal),
            HTTP_AUTHORIZATION=f"Bearer {guest_token}",
        ).json()

    # С R4 обложка есть у каждого заведения, но в тестовой среде Celery не
    # режет варианты — готового url ни у одной нет, и hero пуст. Это и
    # проверяем: заведение с НЕобработанным снимком витрину не занимает.
    assert catalog()["hero_image"] is None

    asset_id = _upload_ready(cms, crystal)
    cms.patch(f"/api/cms/services/{_kitchen(cms)['id']}", {"image_id": asset_id})

    hero = catalog()["hero_image"]
    assert hero  # непустой url фото заведения
