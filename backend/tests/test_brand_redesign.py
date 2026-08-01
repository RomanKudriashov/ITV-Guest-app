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

    # Отдельным полем — тоже. Проверяем именно HTTP-ответ, а не сериализатор:
    # схема ответа выбрасывает всё, чего в ней не объявлено, и обложка однажды
    # уже пропала так — сервер её отдавал, гость не получал, и тест на
    # `theme` (сквозной словарь) этого не замечал.
    response = cms.client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert response.json()["hotel"]["cover_image"] == url


# --- Возврат состояния -----------------------------------------------------


def test_put_replaces_tokens_wholesale_unlike_patch(cms, crystal):
    """
    PUT обязан УБИРАТЬ ключи, которых нет в присланном наборе, — иначе им нельзя
    откатить бренд. Именно на этом автотест бренда необратимо портил демо-отель:
    «восстановление» делалось PATCH-подобной операцией и оставляло за собой
    подложку и чужую гарнитуру.
    """
    # Базу задаём явно: у сидового отеля уже есть обложка, и на ней разницы
    # между merge и replace не увидеть — оба вернут её обратно.
    clean = cms.get("/api/cms/brand").json()["tokens"]
    clean = {
        **clean,
        "brand": {**clean["brand"], "background": {"kind": "gradient", "dim": 0.0}},
    }
    before = cms.put("/api/cms/brand", {"tokens": clean}).json()["tokens"]
    assert "imageUrl" not in before["brand"]["background"]

    # Тест «пачкает» бренд: добавляет ключ, которого в снимке не было.
    cms.patch(
        "/api/cms/brand",
        {"tokens": {"brand": {"background": {"kind": "image", "imageUrl": "http://x/y.webp"}}}},
    )
    dirty = cms.get("/api/cms/brand").json()["tokens"]
    assert dirty["brand"]["background"]["imageUrl"] == "http://x/y.webp"

    # PATCH снимком НЕ вернул бы состояние: deep-merge оставит imageUrl.
    merged = cms.patch("/api/cms/brand", {"tokens": before}).json()["tokens"]
    assert merged["brand"]["background"].get("imageUrl") == "http://x/y.webp"

    # PUT — возвращает ровно снимок.
    restored = cms.put("/api/cms/brand", {"tokens": before}).json()["tokens"]
    assert restored["brand"]["background"].get("imageUrl", "") in ("", None)
    assert restored["preset"] == before["preset"]
    assert restored["typography"]["headingFontFamily"] == before["typography"]["headingFontFamily"]


def test_put_keeps_logos_that_do_not_belong_to_a_colour_set(cms, crystal):
    """Логотип принадлежит отелю, а не набору цветов, и заменой не теряется."""
    cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoDark": "http://x/logo.svg"}}})
    snapshot = cms.get("/api/cms/brand").json()["tokens"]
    stripped = {**snapshot, "brand": {k: v for k, v in snapshot["brand"].items() if k != "logoDark"}}

    restored = cms.put("/api/cms/brand", {"tokens": stripped}).json()["tokens"]
    assert restored["brand"]["logoDark"] == "http://x/logo.svg"
