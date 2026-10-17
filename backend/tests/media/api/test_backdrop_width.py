"""
ФОН БРЕНДА — ШИРИНА 3200 (партия 58а, дочистка).

Замер 17.10: фон «Метрополя» (оригинал 3840×1600) на экране 1440×900 при DPR 2
брал вариант 2400 и растягивался ×1,8. Фону бренда ряд продолжается до 3200
(не шире оригинала); остальным ассетам ряд прежний.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.tasks import process_media_asset, target_widths
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db


def _processed(cms, crystal, size, kind="brand") -> str:
    asset_id = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("bg.png", png_bytes(size), content_type="image/png")},
        {"kind": kind},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    return asset_id


def _widths(crystal, asset_id) -> list[int]:
    with tenant_context(crystal):
        return [w for w, _ in MediaAsset.objects.get(pk=asset_id).width_variants()]


def test_backdrop_series_goes_to_3200_not_wider_than_the_original():
    assert target_widths(3840, backdrop=True) == [400, 800, 1200, 1600, 2400, 3200]
    assert target_widths(3000, backdrop=True) == [400, 800, 1200, 1600, 2400, 3000]
    assert target_widths(1600, backdrop=True) == [400, 800, 1200, 1600]
    # Не фон — ряд прежний.
    assert target_widths(3840) == [400, 800, 1200, 1600, 2400]


def test_publishing_a_backdrop_cuts_the_3200_width(cms, crystal, monkeypatch, django_capture_on_commit_callbacks):
    asset_id = _processed(cms, crystal, (3840, 1600))
    other_id = _processed(cms, crystal, (3840, 1600), kind="item")
    assert _widths(crystal, asset_id)[-1] == 2400, "до публикации фоном — обычный ряд"

    queued = []
    monkeypatch.setattr(process_media_asset, "delay", lambda *a: queued.append(a))
    url = cms.get(f"/api/cms/media/{asset_id}").json()["url"]
    with django_capture_on_commit_callbacks(execute=True):
        r = cms.patch(
            "/api/cms/brand",
            {"tokens": {"brand": {"background": {"kind": "image", "imageUrl": url, "imageAssetId": asset_id}}}},
        )
    assert r.status_code == 200, r.content
    assert queued == [(asset_id, str(crystal.pk))], "фон не поставлен на дорезку"

    process_media_asset.apply(args=queued[0]).get()
    assert _widths(crystal, asset_id) == [400, 800, 1200, 1600, 2400, 3200]
    assert _widths(crystal, other_id)[-1] == 2400, "ширина фона досталась не фону"

    guest_bg = cms.get("/api/cms/brand").json()["tokens"]["brand"]["background"]["imageRef"]
    assert guest_bg["widths"][-1]["w"] == 3200


def test_rerender_command_picks_up_a_backdrop_without_its_width(cms, crystal, monkeypatch):
    from django.core.management import call_command

    asset_id = _processed(cms, crystal, (3840, 1600))
    monkeypatch.setattr(process_media_asset, "delay", lambda *a: None)
    url = cms.get(f"/api/cms/media/{asset_id}").json()["url"]
    cms.patch(
        "/api/cms/brand",
        {"tokens": {"brand": {"background": {"kind": "image", "imageUrl": url, "imageAssetId": asset_id}}}},
    )
    assert _widths(crystal, asset_id)[-1] == 2400

    call_command("rerender_media", "--hotel", crystal.subdomain)
    assert _widths(crystal, asset_id)[-1] == 3200
    # Второй проход — нечего делать (идемпотентно).
    from io import StringIO

    out = StringIO()
    call_command("rerender_media", "--hotel", crystal.subdomain, "--dry-run", stdout=out)
    assert "к перенарезке: 0" in out.getvalue(), out.getvalue()
