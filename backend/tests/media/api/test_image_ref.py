"""
ОБЪЕКТ КАРТИНКИ (партия 58а): гость получает файл по ширине места, а не card 600.

Замер 17.10: окно «House rules» показывало card 600×250 в колонке 400×792 при
DPR 2 — растяжение ×6,3 при оригинале 3624×1510. Теперь API отдаёт ряд ширин
(не шире оригинала), форму кадра, фокус и средний цвет; место выбирает файл само.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.catalog.models import Item, ItemImage
from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.services import image_ref
from apps.media.tasks import process_media_asset
from tests.conftest import host_for
from tests.helpers import png_bytes

pytestmark = pytest.mark.django_db


def _processed(cms, crystal, size) -> str:
    asset_id = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("wide.png", png_bytes(size), content_type="image/png")},
        {"kind": "item"},
    ).json()["id"]
    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    return asset_id


def test_guest_item_gets_widths_not_wider_than_the_original(client, cms, crystal, guest_token):
    asset_id = _processed(cms, crystal, (1700, 1000))
    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        ItemImage.objects.filter(item=item).delete()
        ItemImage.objects.create(item=item, asset_id=asset_id, sort_order=0)

    body = client.get(
        f"/api/guest/item/{item.pk}", HTTP_HOST=host_for(crystal), HTTP_AUTHORIZATION=f"Bearer {guest_token}"
    ).json()
    photo = body["photos"][0]
    # 1700 — меньше 1600×1,15: своей ширины в ряду нет.
    assert [x["w"] for x in photo["widths"]] == [200, 400, 800, 1200, 1600], "ряд ширин не тот или шире оригинала"
    assert (photo["w"], photo["h"]) == (1700, 1000)
    assert photo["focus"] == {"x": 0.5, "y": 0.5}
    assert photo["color"] and photo["color"].startswith("#") and len(photo["color"]) == 7
    assert photo["src"] == photo["widths"][2]["url"], "запасной адрес — не 800"
    # Строками — на релиз, для старых клиентов.
    assert body["images"] and body["image_full"]


def test_series_tops_at_3840_and_fills_the_gap_below_it():
    """Ряд кончается 3840; оригинал между ширинами ряда — своей шириной, но не выше потолка."""
    from apps.media.tasks import target_widths

    assert target_widths(3624) == [400, 800, 1200, 1600, 2400, 3200]  # 3624 < 3200×1,15
    assert target_widths(4000) == [400, 800, 1200, 1600, 2400, 3200, 3840]
    assert target_widths(1400) == [400, 800, 1200, 1400]
    assert target_widths(1300) == [400, 800, 1200]  # 1300 < 1200×1,15 — зазора нет
    assert target_widths(300) == [300]


def test_narrow_original_gets_one_width_its_own(cms, crystal):
    asset_id = _processed(cms, crystal, (300, 200))
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        assert [w for w, _ in asset.width_variants()] == [300]
        ref = image_ref(asset)
    assert [x["w"] for x in ref["widths"]] == [200, 300]


def test_cms_media_carries_the_ref(cms, crystal):
    asset_id = _processed(cms, crystal, (900, 600))
    body = cms.get(f"/api/v1/cms/media/{asset_id}").json()
    # 900 < 800×1,15 — своей ширины в ряду нет.
    assert body["ref"]["w"] == 900 and [x["w"] for x in body["ref"]["widths"]] == [200, 400, 800]
    assert body["focus"] == {"x": 0.5, "y": 0.5}


def test_asset_cut_before_58a_describes_its_frame_not_the_original(cms, crystal):
    """
    Ассет до перенарезки: файлы `card`/`full` вырезаны по рамке. Форма в объекте —
    рамки (по ней витрина считает видимую долю), фокус — центр файла.
    """
    asset_id = _processed(cms, crystal, (1000, 500))
    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        asset.variants = {"thumb": "x/thumb.webp", "card": "x/card.webp", "full": "x/full.webp"}
        asset.crop = {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}
        asset.focus = {"x": 0.25, "y": 0.5}
        ref = image_ref(asset)
    assert (ref["w"], ref["h"]) == (500, 500)
    assert ref["focus"] == {"x": 0.5, "y": 0.5}
    assert [x["w"] for x in ref["widths"]] == [500, 500] or [x["w"] for x in ref["widths"]] == [500]
    # Старое имя варианта ведёт в ряд ширин, когда ряд есть: `full` (1200) у
    # оригинала 1000 — его собственная ширина, последняя в ряду (1000 > 800×1,15).
    with tenant_context(crystal):
        fresh = MediaAsset.objects.get(pk=asset_id)
    assert [w for w, _ in fresh.width_variants()] == [400, 800, 1000]
    assert fresh.url("full").endswith(fresh.variants["w1000"].split("/")[-1])
