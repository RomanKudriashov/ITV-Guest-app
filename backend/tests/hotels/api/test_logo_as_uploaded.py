"""
ЛОГОТИП — КАК ЗАГРУЖЕН (партия 58а, дочистка 2).

CMS клала логотип в токены адресом `card` — WebP 600 с потерями: контур букв
мылился, широкий логотип «Метрополя» (3513×946) терял две трети точек. На
выдаче адрес варианта нашего ассета пересобирается в адрес исходника: PNG с
прозрачностью, SVG вектором. Чужой адрес не трогаем.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.media.tasks import process_media_asset
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db


def _logo(cms, crystal) -> dict:
    body = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("logo.png", png_bytes((1200, 320)), content_type="image/png")},
        {"kind": "brand"},
    ).json()
    process_media_asset.apply(args=(body["id"], str(crystal.pk))).get()
    return cms.get(f"/api/cms/media/{body['id']}").json()


@pytest.mark.parametrize("route", ["/api/cms/brand", "guest"])
def test_logo_is_served_as_uploaded(cms, crystal, client, route):
    from tests.conftest import host_for

    media = _logo(cms, crystal)
    assert media["url"] != media["original_url"]
    assert cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoLight": media["url"]}}}).status_code == 200

    if route == "guest":
        tokens = client.get("/api/guest/hotel", HTTP_HOST=host_for(crystal)).json()["theme"]
    else:
        tokens = cms.get(route).json()["tokens"]
    logo = tokens["brand"]["logoLight"]
    # Не вариант с потерями (решение 16); с партии 61 — вариант `logo` БЕЗ
    # потерь по размеру места, а если он не легче — исходник.
    assert logo != media["url"], "логотип отдан вариантом с потерями"
    assert logo == media["original_url"] or "/logo/" in logo


def test_logo_variant_is_lossless_small_and_keeps_transparency(cms, crystal):
    """
    Укус партии 61: исходник 3513 точек отдавался гостю целиком. Вариант —
    WebP без потерь (чанк VP8L), не шире 480, с прозрачностью; исходник цел.
    """
    import io

    from PIL import Image

    from apps.core.context import tenant_context
    from apps.media.models import MediaAsset
    from apps.media.services import storage

    big = io.BytesIO()
    picture = Image.new("RGBA", (3513, 946), (0, 0, 0, 0))
    for x in range(0, 3513, 7):
        for y in range(200, 746, 3):
            picture.putpixel((x, y), (20, 90, 60, 255))
    picture.save(big, format="PNG")
    body = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("wide-logo.png", big.getvalue(), content_type="image/png")},
        {"kind": "brand"},
    ).json()
    process_media_asset.apply(args=(body["id"], str(crystal.pk))).get()
    media = cms.get(f"/api/cms/media/{body['id']}").json()
    cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoLight": media["url"]}}})

    logo = cms.get("/api/cms/brand").json()["tokens"]["brand"]["logoLight"]
    assert "/logo/" in logo, logo
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=body["id"])
    data = storage.get_bytes(asset.variants["logo"])
    assert data[12:16] == b"VP8L", "вариант логотипа сжат с потерями"
    with Image.open(io.BytesIO(data)) as image:
        assert image.width <= 480
        assert image.mode == "RGBA"
    assert storage.get_bytes(asset.object_key) == big.getvalue(), "исходник изменён"


def test_foreign_logo_address_stays(cms):
    url = "https://example.org/logo.svg"
    cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoDark": url}}})
    assert cms.get("/api/cms/brand").json()["tokens"]["brand"]["logoDark"] == url
