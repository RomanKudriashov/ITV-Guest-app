"""
ЛОГОТИП ИЗ БРЕНДБУКА: ПРОЗРАЧНЫЙ PNG И SVG (партия 25).

Нарезка переводила всё в RGB — прозрачный фон логотипа становился белым
квадратом на тёмном экране входа. SVG не принимался вовсе, хотя это родной
формат брендбука. SVG теперь принимается для бренда — очищенным.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.services import storage
from apps.media.tasks import _render_variants

pytestmark = pytest.mark.django_db


def _logo_png() -> bytes:
    """Красный круг на прозрачном поле: угол прозрачен, центр — нет."""
    image = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    for x in range(300):
        for y in range(300):
            if (x - 150) ** 2 + (y - 150) ** 2 < 100**2:
                image.putpixel((x, y), (200, 20, 40, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_transparent_png_stays_transparent_in_every_variant(cms, crystal):
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("logo.png", _logo_png(), content_type="image/png")},
        {"kind": "brand"},
    )
    assert response.status_code == 201, response.content

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=response.json()["id"])
        variants = _render_variants(storage.get_bytes(asset.object_key), asset)

    for name, key in variants.items():
        with Image.open(io.BytesIO(storage.get_bytes(key))) as variant:
            rgba = variant.convert("RGBA")
            corner = rgba.getpixel((0, 0))
            centre = rgba.getpixel((rgba.width // 2, rgba.height // 2))
        assert corner[3] == 0, f"{name}: прозрачный угол логотипа стал непрозрачным {corner}"
        assert centre[3] == 255, f"{name}: сам знак потерял плотность {centre}"


def test_photo_without_alpha_stays_rgb(cms, crystal):
    """Фото без прозрачности — как было: альфа-канал ему не заводится."""
    buffer = io.BytesIO()
    Image.new("RGB", (120, 80), (10, 120, 200)).save(buffer, format="JPEG")
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("dish.jpg", buffer.getvalue(), content_type="image/jpeg")},
        {"kind": "item"},
    )
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=response.json()["id"])
        variants = _render_variants(storage.get_bytes(asset.object_key), asset)
    with Image.open(io.BytesIO(storage.get_bytes(variants["card"]))) as variant:
        assert variant.mode == "RGB"


HOSTILE_SVG = b"""<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  <image xlink:href="https://evil.example/track.png" width="1" height="1"/>
  <use href="#dot"/>
  <a href="javascript:alert(3)"><circle id="dot" cx="5" cy="5" r="4" fill="#c00"
     onclick="alert(4)" style="fill:url(https://evil.example/x)"/></a>
  <style>@import url(https://evil.example/x.css); .a{fill:#123}</style>
  <rect width="2" height="2" fill="#0a0"/>
</svg>"""


def _upload_svg(cms, content: bytes, kind: str = "brand"):
    return cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("logo.svg", content, content_type="image/svg+xml")},
        {"kind": kind},
    )


def test_svg_logo_is_accepted_clean(cms, crystal):
    response = _upload_svg(cms, HOSTILE_SVG)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["status"] == "ready"
    assert body["url"], "у SVG-логотипа нет адреса для гостя"

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=body["id"])
        stored = storage.get_bytes(asset.object_key).decode()
    assert asset.content_type == "image/svg+xml"
    for hostile in ("<script", "onload", "onclick", "foreignObject", "evil.example", "javascript:", "@import"):
        assert hostile not in stored, f"в сохранённом SVG осталось «{hostile}»"
    # Рисунок и внутренняя ссылка на месте — чистка не выбросила сам логотип.
    assert "<rect" in stored and "circle" in stored and 'href="#dot"' in stored


def test_svg_with_doctype_is_refused(cms):
    bomb = b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>'
    response = _upload_svg(cms, bomb)
    assert response.status_code == 422
    assert response.json()["code"] == "svg_doctype"


def test_svg_is_brand_only(cms):
    """Фото блюда в SVG не бывает: вне бренда — прежний отказ."""
    response = _upload_svg(cms, HOSTILE_SVG, kind="item")
    assert response.status_code == 422
    assert response.json()["code"] == "unsupported_media"


def test_svg_is_not_cropped(cms):
    asset_id = _upload_svg(cms, HOSTILE_SVG).json()["id"]
    response = cms.put(
        f"/api/v1/cms/media/{asset_id}/crop",
        {"crop": {"x": 0, "y": 0, "w": 0.5, "h": 0.5}, "ratio": 1},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "svg_no_crop"


@pytest.mark.parametrize("where", ["form", "query"])
def test_kind_is_read_from_form_and_from_query(cms, crystal, where):
    """
    Вид ассета — из формы (так шлёт панель) и из адреса (так грузят скриптами по
    API). Раньше читался только адрес, и всё из панели ложилось видом `item`.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, format="PNG")
    file = {"file": SimpleUploadedFile("a.png", buffer.getvalue(), content_type="image/png")}
    if where == "form":
        response = cms.upload("/api/v1/cms/media", file, {"kind": "brand"})
    else:
        response = cms.upload("/api/v1/cms/media?kind=brand", file)
    assert response.status_code == 201, response.content
    with tenant_context(crystal):
        assert MediaAsset.objects.get(pk=response.json()["id"]).kind == "brand"
