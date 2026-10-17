"""
КАРТИНКА АВТОТЕСТА НЕ ОСТАЁТСЯ ФОНОМ БРЕНДА (партия 58а, дочистка 2).

05.10 прерванный прогон `brand-backdrop` оставил шахматку фоном «Кристалла»:
обложка главной и фон страницы у гостя — чёрно-белая клетка. Каждый следующий
e2e снимал её как «исходное» и честно возвращал, а сид считал обложку
настроенной — картинка-то живая. Теперь картинка теста (`e2e-…`, прежняя
`checker.png`) обложкой не считается, а уборка возвращает обложку сида.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.core.context import tenant_context
from apps.hotels.models import BrandTheme
from apps.hotels.services.brand_services import cover_is_alive
from apps.media.tasks import process_media_asset
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _upload(cms, crystal, name: str) -> str:
    asset_id = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile(name, png_bytes((1600, 900)), content_type="image/png")},
        {"kind": "brand"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    return asset_id


def _set_background(cms, asset_id: str) -> None:
    url = cms.get(f"/api/cms/media/{asset_id}").json()["url"]
    r = cms.patch(
        "/api/cms/brand",
        {"tokens": {"brand": {"background": {"kind": "image", "imageUrl": url, "imageAssetId": asset_id, "dim": 0}}}},
    )
    assert r.status_code == 200, r.content


def _background(crystal) -> dict:
    with tenant_context(crystal):
        crystal.refresh_from_db()
        return BrandTheme.objects.get(pk=crystal.default_theme_id).tokens["brand"]["background"]


@pytest.mark.parametrize("name", ["e2e-checker.png", "checker.png"])
def test_test_picture_is_not_a_live_cover(cms, crystal, name):
    _set_background(cms, _upload(cms, crystal, name))
    with tenant_context(crystal):
        crystal.refresh_from_db()
        assert not cover_is_alive(BrandTheme.objects.get(pk=crystal.default_theme_id).tokens)


def test_real_cover_stays_alive(cms, crystal):
    _set_background(cms, _upload(cms, crystal, "hotel-cover--1-abc.jpg"))
    with tenant_context(crystal):
        crystal.refresh_from_db()
        assert cover_is_alive(BrandTheme.objects.get(pk=crystal.default_theme_id).tokens)


def test_residue_cleanup_puts_the_seed_cover_back(cms, crystal):
    seed_cover = _upload(cms, crystal, "hotel-cover--1566073771259-6a8506099945.jpg")
    _set_background(cms, _upload(cms, crystal, "e2e-checker.png"))

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)

    background = _background(crystal)
    assert background["imageAssetId"] == seed_cover, "шахматка осталась фоном бренда"
    assert background["kind"] == "image" and background["dim"] == 0.15
    assert "imageRef" not in background


def test_put_does_not_store_the_resolved_image_ref(cms, crystal):
    """PUT целиком присланных токенов не пишет собранный на выдаче `imageRef`."""
    _set_background(cms, _upload(cms, crystal, "hotel-cover--2-abc.jpg"))
    tokens = cms.get("/api/cms/brand").json()["tokens"]
    assert "imageRef" in tokens["brand"]["background"], "выдача без объекта картинки — проверять нечего"
    assert cms.put("/api/cms/brand", {"tokens": tokens}).status_code == 200
    assert "imageRef" not in _background(crystal)
