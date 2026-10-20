"""
УБОРКА ПРЕЖНЕЙ НАРЕЗКИ (партия 58в): `card`, `full`, `old-…` у перенарезанных.

Удаляются файлы прежней нарезки — и только у ассета с рядом ширин. Исходник и
нынешний ряд не трогаются; ассет без ряда (не перенарезан) — тоже. Имена
удалённых ключей остаются, и логотип, записанный в токенах адресом прежнего
варианта, по-прежнему отдаётся гостю исходником.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from PIL import Image

from apps.core.context import tenant_context
from apps.hotels.services.brand_services import _logo_as_uploaded
from apps.media.models import MediaAsset
from apps.media.services import storage
from apps.media.tasks import process_media_asset

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _png(w: int, h: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (w, h), (90, 60, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _asset_with_old_files(cms, crystal) -> tuple[str, dict]:
    asset_id = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("photo.png", _png(1000, 700), content_type="image/png")},
        {"kind": "item"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        old = {}
        for name in ("card", "full", "old-w400"):
            key = storage.object_key(crystal.pk, asset.kind, f"{name}-{asset_id}.webp", variant=name)
            storage.put_bytes(key, b"x" * 2048, content_type="image/webp")
            old[name] = key
        asset.variants = {**asset.variants, **old}
        asset.save(update_fields=["variants"])
    return asset_id, old


def test_dry_run_counts_and_keeps(cms, crystal, capsys):
    asset_id, old = _asset_with_old_files(cms, crystal)
    call_command("clean_old_variants", "--dry-run", "--hotel", "crystal")
    out = capsys.readouterr().out
    assert "к уборке" in out and "Пробный проход" in out
    for key in old.values():
        assert storage.object_size(key) == 2048, "пробный проход удалил файл"


def test_apply_removes_old_files_only(cms, crystal):
    asset_id, old = _asset_with_old_files(cms, crystal)
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        series = dict(asset.width_variants())
        original = asset.object_key

    call_command("clean_old_variants", "--hotel", "crystal", verbosity=0)

    for key in old.values():
        assert storage.object_size(key) == 0, f"старый файл остался: {key}"
    assert storage.object_size(original) > 0, "исходник удалён"
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        assert not {"card", "full", "old-w400"} & set(asset.variants)
        assert dict(asset.width_variants()) == series, "нынешний ряд тронут"
        assert set(old.values()) <= set(asset.variants["retired"])
        assert asset.url("card"), "url('card') не нашёл файл в ряду"


def test_logo_stored_as_an_old_variant_still_resolves_to_the_original(cms, crystal):
    asset_id, old = _asset_with_old_files(cms, crystal)
    call_command("clean_old_variants", "--hotel", "crystal", verbosity=0)
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        url = asset.key_url(old["card"])
        # Исходник или его вариант без потерь `logo` (партия 61) — но не старый
        # вариант с потерями.
        resolved = _logo_as_uploaded(url)
        assert resolved == asset.original_url() or "/logo/" in resolved
        assert resolved != url


def test_asset_without_series_is_untouched(cms, crystal):
    asset_id, old = _asset_with_old_files(cms, crystal)
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        asset.variants = {"thumb": asset.variants["thumb"], **old}
        asset.save(update_fields=["variants"])
    call_command("clean_old_variants", "--hotel", "crystal", verbosity=0)
    for key in old.values():
        assert storage.object_size(key) == 2048, "у ассета без ряда убраны единственные варианты"
