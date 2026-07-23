"""
Контраст палитры (редизайн R2b).

Баг, который чинили: на светлой теме встречался светлый текст на светлом фоне —
вывод цвета текста считал базу тёмной. Этот тест держит инвариант: у КАЖДОГО
пресета в ОБОИХ режимах текст читается на фоне, на поверхности и на заливках
акцента. Ослаблять пороги нельзя — иначе баг вернётся незаметно.
"""

from __future__ import annotations

import pytest

from apps.hotels.brand_library import BADGE_ROLE_FIELDS, list_presets
from apps.hotels.brand_palette import contrast_on, contrast_ratio

# Пороги WCAG: основной текст — AA (4.5), вторичный текст и текст на заливках —
# минимум для крупного/UI (3.0).
TEXT_MIN = 4.5
UI_MIN = 3.0


@pytest.mark.parametrize("preset", list_presets(), ids=lambda p: p["code"])
def test_preset_text_is_readable_in_both_modes(preset):
    for mode in ("light", "dark"):
        p = preset["tokens"]["palette"][mode]
        code = preset["code"]

        assert contrast_ratio(p["text"], p["background"]) >= TEXT_MIN, (code, mode, "text/background")
        assert contrast_ratio(p["text"], p["surface"]) >= TEXT_MIN, (code, mode, "text/surface")
        assert contrast_ratio(p["text"], p["surfaceMuted"]) >= TEXT_MIN, (code, mode, "text/surfaceMuted")
        # Вторичный текст слабее, но остаётся читаемым.
        assert contrast_ratio(p["textSecondary"], p["surface"]) >= UI_MIN, (code, mode, "textSecondary/surface")
        # Контрастный текст на заливках акцента (кнопки, бейджи).
        assert contrast_ratio(p["primaryContrast"], p["primary"]) >= UI_MIN, (code, mode, "primaryContrast/primary")
        assert contrast_ratio(p["secondaryContrast"], p["secondary"]) >= UI_MIN, (code, mode, "secondaryContrast/secondary")


@pytest.mark.parametrize("preset", list_presets(), ids=lambda p: p["code"])
def test_badge_color_roles_are_readable(preset):
    """
    Бейдж (A3+): текст на заливке роли берётся по контрасту. Проверяем, что у
    КАЖДОГО пресета в ОБОИХ режимах любая роль бейджа читаема — роль, выбранная
    под тёмную тему, не должна провалить контраст в светлой.
    """
    for mode in ("light", "dark"):
        palette = preset["tokens"]["palette"][mode]
        for role, field in BADGE_ROLE_FIELDS.items():
            fill = palette[field]
            text = contrast_on(fill)
            assert contrast_ratio(text, fill) >= UI_MIN, (preset["code"], mode, role, fill)
