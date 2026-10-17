"""
ПРЕДЕЛ РАЗМЕРА ЛОГОТИПА (партия 58б).

Логотип уходит гостю как есть, без пережатия (партия 58а): многомегабайтный
PNG ушёл бы на каждый экран гостя. Панель грузит логотип с назначением
`purpose=logo`, и сервер отвечает понятной причиной — тот же предел держит и
скрипт по API мимо панели. Остальные картинки бренда (фон) — прежние 10 МБ.
"""

from __future__ import annotations

import io
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

pytestmark = pytest.mark.django_db


def _heavy_png() -> bytes:
    """Шум 800×800: PNG почти не сжимает его — около 1,9 МБ."""
    image = Image.frombytes("RGB", (800, 800), os.urandom(800 * 800 * 3))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    data = buffer.getvalue()
    assert len(data) > 1024 * 1024
    return data


def test_heavy_logo_is_refused_with_a_reason(cms, crystal):
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("logo.png", _heavy_png(), content_type="image/png")},
        {"kind": "brand", "purpose": "logo"},
    )
    assert response.status_code in (400, 422), response.content
    body = response.json()
    assert "logo_too_large" in str(body)
    assert "как есть" in str(body), "причина не названа"


def test_same_file_as_brand_background_is_accepted(cms, crystal):
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("cover.png", _heavy_png(), content_type="image/png")},
        {"kind": "brand"},
    )
    assert response.status_code == 201, response.content


def test_light_logo_is_accepted(cms, crystal):
    image = Image.new("RGBA", (200, 80), (10, 20, 30, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("logo.png", buffer.getvalue(), content_type="image/png")},
        {"kind": "brand", "purpose": "logo"},
    )
    assert response.status_code == 201, response.content
