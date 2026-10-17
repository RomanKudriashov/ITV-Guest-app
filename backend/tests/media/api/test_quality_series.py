"""
КАЧЕСТВО НЕ ЭКОНОМИМ (партия 58а, дочистка 2; docs/decisions.md, п.16).

Ряд ширин 400…3840 (не шире оригинала, плюс своя ширина в зазоре) и WebP 90 —
для всех ассетов. Нарезка с прежним рядом (до 2400) или прежним качеством (80)
— повод для `rerender_media`, и `--dry-run` её видит.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.tasks import needs_rerender, process_media_asset, target_widths
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db


def test_series_goes_to_3840_and_fills_the_gap():
    assert target_widths(5000) == [400, 800, 1200, 1600, 2400, 3200, 3840]
    assert target_widths(3840) == [400, 800, 1200, 1600, 2400, 3200, 3840]
    assert target_widths(3000) == [400, 800, 1200, 1600, 2400, 3000]
    assert target_widths(1400) == [400, 800, 1200, 1400]
    assert target_widths(1300) == [400, 800, 1200]


def test_variants_are_cut_at_quality_90(cms, crystal, settings):
    asset_id = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("p.png", png_bytes((1000, 600)), content_type="image/png")},
        {"kind": "item"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
    assert settings.MEDIA_WEBP_QUALITY == 90
    assert asset.variant_quality == 90
    assert not needs_rerender(asset)


def test_dry_run_catches_the_old_cut(cms, crystal):
    """Нарезка 58а (ряд до 2400, качество 80) — к перенарезке; после неё — нет."""
    asset_id = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("w.png", png_bytes((3840, 1600)), content_type="image/png")},
        {"kind": "brand"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        # Как резала 58а до дочистки: без 3200/3840 и без пометки качества.
        asset.variants = {k: v for k, v in asset.variants.items() if k not in ("w3200", "w3840")}
        asset.variant_quality = 0
        asset.save(update_fields=["variants", "variant_quality"])
        assert needs_rerender(asset)

    out = io.StringIO()
    call_command("rerender_media", "--hotel", crystal.subdomain, "--dry-run", stdout=out)
    assert "к перенарезке: 0" not in out.getvalue(), out.getvalue()

    call_command("rerender_media", "--hotel", crystal.subdomain, stdout=io.StringIO())
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
    assert [w for w, _ in asset.width_variants()][-2:] == [3200, 3840]
    assert asset.variant_quality == 90
    # Прежний ряд — рядом, под `old-`: на него могут смотреть строки в токенах.
    assert any(name.startswith("old-w") for name in asset.variants)

    out = io.StringIO()
    call_command("rerender_media", "--hotel", crystal.subdomain, "--dry-run", stdout=out)
    assert "к перенарезке: 0" in out.getvalue(), out.getvalue()
