"""
Редизайн v2: тёмно-синие пресеты, дисплейный Onest, загрузка подложки-картинки.

Дополняет test_brand: там проверено, что тема доезжает до гостя вообще; здесь —
что новый фундамент (пресеты и подложка) доезжает так же.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.hotels.brand_library import preset_tokens

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _guest_theme(client, hotel):
    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    return response.json()["hotel"]["theme"]


def _png(width=1200, height=800) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (12, 20, 32)).save(buffer, format="PNG")
    return buffer.getvalue()


# --- Библиотека ------------------------------------------------------------


def test_onest_is_in_curated_fonts(cms):
    fonts = cms.get("/api/cms/brand/fonts").json()["fonts"]
    assert any(font["name"] == "Onest" for font in fonts)


def test_dark_blue_presets_are_available(cms):
    presets = {p["code"]: p for p in cms.get("/api/cms/brand/presets").json()["presets"]}
    # Тёмно-синий образ по умолчанию и другие синие пресеты добавлены.
    assert {"midnight_navy", "sapphire_dark", "porcelain_navy", "harbor_light"} <= set(presets)
    signature = presets["midnight_navy"]
    assert signature["default_mode"] == "dark"
    # Полный набор токенов, как и у остальных.
    assert len(signature["tokens"]["palette"]["dark"]) == 18


def test_dark_blue_preset_applies_and_reaches_guest(client, crystal, cms):
    applied = cms.post("/api/cms/brand/apply-preset", {"preset": "midnight_navy"}).json()
    assert applied["preset"] == "midnight_navy"

    theme = _guest_theme(client, crystal)
    assert theme["preset"] == "midnight_navy"
    assert theme["palette"]["dark"]["primary"] == (
        preset_tokens("midnight_navy")["palette"]["dark"]["primary"]
    )
    # Тёмный образ: режим по умолчанию — тёмный.
    assert theme["brand"]["defaultMode"] == "dark"


# --- Подложка через медиапайплайн ------------------------------------------


def test_background_image_upload_reaches_guest(cms, crystal):
    uploaded = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("bg.png", _png(), content_type="image/png")},
        {"kind": "brand"},
    )
    assert uploaded.status_code == 201, uploaded.content
    asset_id = uploaded.json()["id"]

    from apps.media.tasks import process_media_asset

    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    url = cms.get(f"/api/cms/media/{asset_id}").json()["url"]

    # Подложка + затемнение отдельным токеном (одна картинка на обе темы).
    saved = cms.patch(
        "/api/cms/brand",
        {"tokens": {"brand": {"background": {"kind": "image", "imageUrl": url, "dim": 0.4}}}},
    ).json()
    bg = saved["tokens"]["brand"]["background"]
    assert bg["kind"] == "image"
    assert bg["imageUrl"] == url
    assert bg["dim"] == 0.4

    # И подложка доезжает до гостя.
    guest_bg = _guest_theme(cms.client, crystal)["brand"]["background"]
    assert guest_bg["imageUrl"] == url
    assert guest_bg["dim"] == 0.4
