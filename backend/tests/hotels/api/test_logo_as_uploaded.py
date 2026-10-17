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
    assert tokens["brand"]["logoLight"] == media["original_url"], "логотип отдан вариантом с потерями"


def test_foreign_logo_address_stays(cms):
    url = "https://example.org/logo.svg"
    cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoDark": url}}})
    assert cms.get("/api/cms/brand").json()["tokens"]["brand"]["logoDark"] == url
