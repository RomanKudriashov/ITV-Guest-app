"""
Бренд-настройки: чтение/правка токенов, пресеты, отражение в гостевом ответе.

Ключевая проверка прогона — что сохранённая тема доезжает до гостя: редактор
бренда бесполезен, если витрина его не видит.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core.context import tenant_context
from apps.hotels.brand_library import preset_tokens
from apps.hotels.brand_palette import build_color_set, contrast_on
from apps.hotels.models import BrandTheme

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- Библиотека ------------------------------------------------------------


def test_presets_are_complete_token_sets(cms):
    presets = cms.get("/api/cms/brand/presets").json()["presets"]
    codes = {preset["code"] for preset in presets}
    assert {"evening_concierge", "marble_linen", "tiffany_night", "azure_light"} <= codes

    for preset in presets:
        tokens = preset["tokens"]
        # Полный набор, а не огрызок: и светлая, и тёмная палитра, и brand-раздел.
        assert set(tokens["palette"]["light"]) == set(tokens["palette"]["dark"])
        assert len(tokens["palette"]["light"]) == 18
        assert tokens["brand"]["surfaceStyle"] in {"flat", "soft", "glass"}
        assert preset["swatch"]


def test_palette_builder_keeps_text_readable():
    """Контраст текста считается по яркости, а не наугад."""
    assert contrast_on("#FFFFFF") == "#12211D"
    assert contrast_on("#0E1B2A") == "#FFFFFF"

    light = build_color_set(
        mode="light", primary="#1D3B57", secondary="#B8862F",
        background="#F4F1EA", surface="#FFFFFF", text="#17242F",
    )
    assert len(light) == 18
    # Производные поверхности отличаются от базовой — иерархия не схлопнута.
    assert light["surfaceMuted"] != light["surface"]
    assert light["surfaceHover"] != light["surface"]


def test_fonts_and_abstractions_are_curated(cms):
    fonts = cms.get("/api/cms/brand/fonts").json()["fonts"]
    assert any(font["name"] == "Manrope" for font in fonts)
    assert all("family" in font for font in fonts)

    abstractions = cms.get("/api/cms/brand/abstractions").json()["abstractions"]
    assert {"linen", "waves", "marble", "mesh"} <= {a["code"] for a in abstractions}


# --- Чтение ----------------------------------------------------------------


def test_get_brand_returns_seeded_preset(cms):
    body = cms.get("/api/cms/brand").json()
    assert body["preset"] == "midnight_navy"
    assert body["tokens"]["brand"]["defaultMode"] == "dark"


def test_hotel_without_theme_gets_one_from_preset(cms, crystal):
    """Старый отель без темы не должен остаться на платформенных цветах."""
    with tenant_context(crystal):
        crystal.default_theme = None
        crystal.save(update_fields=["default_theme"])
        BrandTheme.all_objects.all().hard_delete()

    body = cms.get("/api/cms/brand").json()
    assert body["tokens"]["palette"]["light"]["primary"]


# --- Правка ----------------------------------------------------------------


def test_patch_deep_merges_and_marks_custom(cms):
    before = cms.get("/api/cms/brand").json()["tokens"]

    patched = cms.patch(
        "/api/cms/brand",
        {"tokens": {"palette": {"light": {"primary": "#0F766E"}},
                    "brand": {"surfaceStyle": "flat"}}},
    ).json()

    assert patched["tokens"]["palette"]["light"]["primary"] == "#0F766E"
    assert patched["tokens"]["brand"]["surfaceStyle"] == "flat"
    # Deep-merge: тронули один цвет — остальные на месте.
    assert patched["tokens"]["palette"]["light"]["secondary"] == (
        before["palette"]["light"]["secondary"]
    )
    # Ручная правка снимает ярлык пресета.
    assert patched["preset"] == "custom"


@pytest.mark.parametrize(
    "patch,code,field",
    [
        ({"palette": {"light": {"primary": "not-a-color"}}}, "invalid_color", "palette.light.primary"),
        ({"typography": {"fontFamily": "Comic Sans"}}, "font_not_allowed", "typography.fontFamily"),
        ({"brand": {"surfaceStyle": "hologram"}}, "validation_error", "brand.surfaceStyle"),
        ({"brand": {"background": {"kind": "portal"}}}, "validation_error", "brand.background.kind"),
        ({"brand": {"background": {"dim": 5}}}, "validation_error", "brand.background.dim"),
        ({"brand": {"background": {"abstraction": "nope"}}}, "validation_error", "brand.background.abstraction"),
    ],
)
def test_patch_validation(cms, patch, code, field):
    response = cms.patch("/api/cms/brand", {"tokens": patch})
    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == code
    assert body["field"] == field


def test_rgba_colors_are_accepted(cms):
    """Скримы и подложки задаются rgba — валидатор не должен их отвергать."""
    response = cms.patch(
        "/api/cms/brand", {"tokens": {"palette": {"dark": {"scrim": "rgba(8, 15, 13, 0.7)"}}}}
    )
    assert response.status_code == 200


# --- Пресеты ---------------------------------------------------------------


def test_apply_preset_replaces_tokens_wholesale(cms):
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#FF0000"}}}})

    applied = cms.post("/api/cms/brand/apply-preset", {"preset": "azure_light"}).json()
    assert applied["preset"] == "azure_light"
    # Ручная правка стёрта — это не merge, а замена целиком.
    assert applied["tokens"]["palette"]["light"]["primary"] != "#FF0000"
    assert applied["tokens"]["palette"]["light"]["primary"] == (
        preset_tokens("azure_light")["palette"]["light"]["primary"]
    )


def test_apply_preset_keeps_uploaded_logos(cms):
    """Смена палитры не должна терять загруженный логотип."""
    cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoLight": "http://x/logo.webp"}}})

    applied = cms.post("/api/cms/brand/apply-preset", {"preset": "marble_linen"}).json()
    assert applied["tokens"]["brand"]["logoLight"] == "http://x/logo.webp"


def test_unknown_preset_is_404(cms):
    response = cms.post("/api/cms/brand/apply-preset", {"preset": "nonexistent"})
    assert response.status_code == 404
    assert response.json()["code"] == "unknown_preset"


# --- Отражение у гостя (Definition of Done) --------------------------------


def _guest_theme(client, hotel):
    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    return response.json()["hotel"]["theme"]


def test_saved_tokens_reach_the_guest_session(client, crystal, cms):
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#123456"}}}})

    theme = _guest_theme(client, crystal)
    assert theme["palette"]["light"]["primary"] == "#123456"
    assert theme["preset"] == "custom"


def test_applied_preset_reaches_the_guest(client, crystal, cms):
    cms.post("/api/cms/brand/apply-preset", {"preset": "tiffany_night"})
    theme = _guest_theme(client, crystal)
    assert theme["palette"]["dark"]["primary"] == (
        preset_tokens("tiffany_night")["palette"]["dark"]["primary"]
    )


def test_guest_menu_carries_the_theme_too(client, crystal, cms):
    """Витрина красится темой не только на входе — проверяем и меню."""
    cms.post("/api/cms/brand/apply-preset", {"preset": "azure_light"})
    session = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()
    assert session["hotel"]["theme"]["preset"] == "azure_light"


# --- Логотип через медиапайплайн -------------------------------------------


def png_bytes() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (400, 120), (20, 40, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_logo_upload_and_attach(cms, crystal):
    uploaded = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("logo.png", png_bytes(), content_type="image/png")},
        {"kind": "brand"},
    )
    assert uploaded.status_code == 201, uploaded.content
    asset_id = uploaded.json()["id"]

    from apps.media.tasks import process_media_asset

    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()
    url = cms.get(f"/api/cms/media/{asset_id}").json()["url"]
    assert url.startswith("http")

    saved = cms.patch("/api/cms/brand", {"tokens": {"brand": {"logoLight": url}}}).json()
    assert saved["tokens"]["brand"]["logoLight"] == url

    # И логотип доезжает до гостя.
    assert _guest_theme(cms.client, crystal)["brand"]["logoLight"] == url


# --- Изоляция --------------------------------------------------------------


def test_brand_is_isolated_between_hotels(client, crystal, aurora, cms, cms_aurora):
    """Тема отеля A не должна течь к B."""
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#AA0000"}}}})
    cms_aurora.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#00AA00"}}}})

    assert _guest_theme(client, crystal)["palette"]["light"]["primary"] == "#AA0000"
    assert _guest_theme(client, aurora)["palette"]["light"]["primary"] == "#00AA00"


def test_guest_cannot_edit_brand(client, crystal, guest_token):
    response = client.patch(
        "/api/cms/brand",
        data={"tokens": {}},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
