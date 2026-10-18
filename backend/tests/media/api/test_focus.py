"""
ТОЧКА ГЛАВНОГО ВМЕСТО РАМКИ КАДРА (партия 58в).

После 58а варианты режутся из целого оригинала, а место показа кладёт фото по
фокусу. Рамка `crop` жила релиз только ради старого редактора — редактор теперь
ставит точку главного: она сохраняется сразу, нарезку не трогает, рамки в API нет.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.tasks import process_media_asset

pytestmark = pytest.mark.django_db


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 80, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def uploaded(cms, crystal):
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("wide.png", _png(400, 300), content_type="image/png")},
        {"kind": "item"},
    )
    assert response.status_code == 201, response.content
    body = response.json()
    process_media_asset.apply(args=(body["id"], str(crystal.pk))).get()
    return body


def test_upload_has_focus_in_the_centre_and_no_frame(uploaded):
    assert uploaded["focus"] == {"x": 0.5, "y": 0.5}
    assert "crop" not in uploaded and "crop_ratio" not in uploaded
    assert uploaded["original_url"]


def test_focus_is_stored_and_does_not_rerender(uploaded, cms, crystal):
    with tenant_context(crystal):
        before = MediaAsset.objects.get(pk=uploaded["id"]).variants
    response = cms.put(f"/api/v1/cms/media/{uploaded['id']}/focus", {"x": 0.8, "y": 0.2})
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["focus"] == {"x": 0.8, "y": 0.2}
    assert body["status"] == "ready", "точка главного не должна перезапускать нарезку"
    assert body["ref"]["focus"] == {"x": 0.8, "y": 0.2}
    with tenant_context(crystal):
        assert MediaAsset.objects.get(pk=uploaded["id"]).variants == before


def test_focus_outside_the_photo_is_clamped(uploaded, cms):
    body = cms.put(f"/api/v1/cms/media/{uploaded['id']}/focus", {"x": 1.7, "y": -0.3}).json()
    assert body["focus"] == {"x": 1.0, "y": 0.0}


def test_old_frame_endpoint_is_gone(uploaded, cms):
    response = cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "ratio": 1},
    )
    assert response.status_code in (404, 405)


def test_model_has_no_frame_fields():
    names = {field.name for field in MediaAsset._meta.get_fields()}
    assert "crop" not in names and "crop_ratio" not in names
