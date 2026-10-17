"""
КАДР ХРАНИТСЯ КООРДИНАТАМИ, ИСХОДНИК НЕ ТРОГАЕТСЯ.

Человек загрузил, обрезал, через неделю передумал — и должен увидеть картинку
целиком, а не то, что от неё осталось. С обрезанным файлом «передумал» стоит
хранения родословной; с координатами он бесплатен, и вторая обрезка режет
оригинал, а не результат первой.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.core.context import tenant_context
from apps.media.models import MediaAsset

pytestmark = pytest.mark.django_db


def _png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    # Пёстрая картинка, а не заливка: по одноцветной нельзя увидеть, что кадр
    # действительно взят из другого места.
    image = Image.new("RGB", (width, height))
    for x in range(width):
        for y in range(height):
            image.putpixel((x, y), (x % 256, y % 256, (x + y) % 256))
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def uploaded(cms):
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("wide.png", _png(400, 300), content_type="image/png")},
        {"kind": "item"},
    )
    assert response.status_code == 201, response.content
    return response.json()


def test_upload_has_no_crop_and_offers_the_original(uploaded):
    """Без обрезки кадр не выбран, а исходник доступен редактору."""
    assert uploaded["crop"] is None
    assert uploaded["crop_ratio"] is None
    assert uploaded["original_url"], "редактору кадра нечего показать"


def test_crop_is_stored_as_coordinates_not_a_new_file(uploaded, cms, crystal):
    with tenant_context(crystal):
        key_before = MediaAsset.objects.get(pk=uploaded["id"]).object_key

    response = cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0.25, "y": 0.0, "w": 0.5, "h": 0.5}, "ratio": 16 / 9},
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["crop"] == {"x": 0.25, "y": 0.0, "w": 0.5, "h": 0.5}
    assert round(body["crop_ratio"], 4) == round(16 / 9, 4)
    # Нарезка идёт в воркере — до её конца честно `pending`.
    assert body["status"] == "pending"

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=uploaded["id"])
        # ГЛАВНОЕ: оригинал остался тем же объектом в хранилище.
        assert asset.object_key == key_before
        # И размеры описывают ИСХОДНИК, а не рамку.
        assert (asset.width, asset.height) in {(400, 300), (None, None)}


def test_recrop_reads_the_original_not_the_previous_crop(uploaded, cms, crystal):
    """
    Вторая обрезка не режет первую.

    Если бы кадр записывался новым файлом, «взять шире, чем в прошлый раз» было
    бы невозможно: пикселей за прежней рамкой уже не существовало бы.
    """
    cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2}, "ratio": 1.0},
    )
    # Берём ШИРЕ прежнего — рамка целиком за пределами первой.
    wider = cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.5}, "ratio": 2.0},
    ).json()
    assert wider["crop"] == {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.5}

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=uploaded["id"])
        assert asset.crop["w"] == 1.0, "вторая обрезка отрезала то, чего уже нет"


def test_crop_can_be_taken_off(uploaded, cms, crystal):
    cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}, "ratio": 1.0},
    )
    cleared = cms.put(f"/api/v1/cms/media/{uploaded['id']}/crop", {"crop": None}).json()
    assert cleared["crop"] is None
    with tenant_context(crystal):
        assert MediaAsset.objects.get(pk=uploaded["id"]).crop is None


def test_broken_frame_is_refused_not_swallowed(uploaded, cms):
    """
    Рамка без половины полей — ошибка клиента, а не повод обрезать наугад.
    Молча взять «что прислали» значило бы показать гостю не тот кадр.
    """
    response = cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop", {"crop": {"x": 0.1, "y": 0.1}}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "bad_crop"


def test_variants_are_not_cut_by_the_frame_any_more():
    """
    ВАРИАНТЫ — ЦЕЛЫЙ ОРИГИНАЛ (партия 58а). Рамка остаётся координатами для
    старого редактора, но файлы гостю режутся из всего кадра: куда смотреть,
    место показа берёт из фокуса. Рамка резала фото под одну форму, а показывают
    его в десятке, и баннер терял 69% ещё на сервере (замер 17.10).
    """
    from types import SimpleNamespace

    from apps.media.tasks import render_variant_bytes

    asset = SimpleNamespace(crop={"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5})
    bodies = render_variant_bytes(_png(400, 300), asset)
    sizes = {name: Image.open(io.BytesIO(body)).size for name, body in bodies.items()}
    assert sizes["w400"] == (400, 300), f"вариант вырезан по рамке: {sizes}"
    assert sizes["thumb"] == (200, 150)


def test_crop_sets_the_focus_to_the_frame_centre(uploaded, cms, crystal):
    """Старый редактор пишет рамку — сервер ставит фокус в её центр."""
    body = cms.put(
        f"/api/v1/cms/media/{uploaded['id']}/crop",
        {"crop": {"x": 0.5, "y": 0.0, "w": 0.5, "h": 0.4}, "ratio": 2.0},
    ).json()
    assert body["focus"] == {"x": 0.75, "y": 0.2}
    cleared = cms.put(f"/api/v1/cms/media/{uploaded['id']}/crop", {"crop": None}).json()
    assert cleared["focus"] == {"x": 0.5, "y": 0.5}


def test_images_uploaded_before_the_cropper_stay_as_they_were(cms, crystal):
    """
    СТАРЫЕ КАРТИНКИ НЕ ЕДУТ.

    У всего, что загрузили до появления кадра, `crop` пуст — и рендер в этом
    случае возвращает картинку целиком, тем же кодом, что и раньше. Ничего не
    перенарезается: варианты уже лежат в хранилище, и никто их не трогает,
    пока человек сам не откроет обрезку.

    Проверка нужна именно как сторож: соблазн «а давайте заодно пересчитаем всё
    под новые правила» стоил бы отелю разъехавшихся кадров во всём каталоге
    разом — и никто бы не понял, почему.
    """
    response = cms.upload(
        "/api/v1/cms/media",
        {"file": SimpleUploadedFile("old.png", _png(400, 300), content_type="image/png")},
        {"kind": "item"},
    )
    asset_id = response.json()["id"]

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        variants_before = dict(asset.variants)
        # Так выглядит ассет, загруженный до кроппера: рамки нет.
        assert asset.crop is None

    # Ассет читают, показывают, редактируют соседние поля — кадр не появляется.
    assert cms.get(f"/api/v1/cms/media/{asset_id}").json()["crop"] is None

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
        assert asset.variants == variants_before, "варианты пересчитались сами по себе"


