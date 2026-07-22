"""
Курируемая библиотека бренда: пресеты, шрифты, фоны-абстракции.

Всё это — данные, которые поставляем мы, а не отель. Пресеты дают цельный
стартовый набор, шрифты ограничены лицензионно чистым списком, абстракции —
готовые подложки. Отель выбирает из библиотеки и дальше правит токены; свои
файлы шрифтов и «любые» цвета мимо валидации сюда не попадают.
"""

from __future__ import annotations

from .brand_palette import build_color_set

# --- Шрифты ----------------------------------------------------------------
# `family` — ровно та строка, что уходит в typography.fontFamily. По этому же
# списку валидируются fontFamily и headingFontFamily в PATCH.

FONTS = [
    {"family": "'Manrope', system-ui, sans-serif", "name": "Manrope", "category": "sans"},
    {"family": "'Inter', system-ui, sans-serif", "name": "Inter", "category": "sans"},
    {"family": "'Golos Text', system-ui, sans-serif", "name": "Golos Text", "category": "sans"},
    # Дисплейный шрифт редизайна v2 — гротеск Onest, для заголовков, названий, цен.
    {"family": "'Onest', system-ui, sans-serif", "name": "Onest", "category": "sans"},
    {"family": "'Cormorant Garamond', Georgia, serif", "name": "Cormorant Garamond", "category": "serif"},
    {"family": "'Playfair Display', Georgia, serif", "name": "Playfair Display", "category": "serif"},
    {"family": "'Lora', Georgia, serif", "name": "Lora", "category": "serif"},
]

FONT_FAMILIES = {font["family"] for font in FONTS}


# --- Абстракции-подложки ---------------------------------------------------

from .brand_patterns import abstraction_svg

_ABSTRACTION_NAMES = [
    ("linen", "Лён"),
    ("waves", "Волны"),
    ("marble", "Мрамор"),
    ("mesh", "Сетка"),
    ("dune", "Дюны"),
]

# preview_url — самодостаточный data-URI: не зависит от раздачи статики и
# работает в превью-фрейме напрямую.
ABSTRACTIONS = [
    {"code": code, "name": name, "preview_url": abstraction_svg(code)}
    for code, name in _ABSTRACTION_NAMES
]

ABSTRACTION_CODES = {entry["code"] for entry in ABSTRACTIONS}


# --- Пресеты ---------------------------------------------------------------

SURFACE_STYLES = {"flat", "soft", "glass"}
DEFAULT_MODES = {"light", "dark", "system"}
BACKGROUND_KINDS = {"solid", "gradient", "image", "abstraction"}


def _typography(body: str, heading: str, scale: float = 1.0) -> dict:
    return {
        "fontFamily": body,
        "headingFontFamily": heading,
        "fontSizeBase": 16,
        "fontWeightRegular": 400,
        "fontWeightMedium": 500,
        "fontWeightBold": 700,
        "headingScale": scale,
    }


_ONEST = "'Onest', system-ui, sans-serif"
_MANROPE = "'Manrope', system-ui, sans-serif"

# Опорные цвета пресета: (primary, secondary, bg, surface, text) на каждый режим.
_PRESET_SEEDS = {
    # --- Редизайн v2: тёмно-синие пресеты (образ по умолчанию) --------------
    "midnight_navy": {
        "name": "Полуночный синий",
        "description": "Тёмная база, насыщенный синий акцент, дисплейный Onest — сигнатурный образ (эталон витрины)",
        "default_mode": "dark",
        "surface_style": "glass",
        "radius": (12, 20),
        "fonts": (_MANROPE, _ONEST, 1.12),
        # Опорные цвета сведены к эталону: база #0B1220, поверхность #131C2E,
        # акцент #2F62C4, золото бейджей #E3B23C, текст #EEF3FB.
        "swatch": ["#0B1220", "#2F62C4", "#131C2E"],
        "light": ("#2456A0", "#9C7A4E", "#F4F6FB", "#FFFFFF", "#12202F"),
        "dark": ("#2F62C4", "#E3B23C", "#0B1220", "#131C2E", "#EEF3FB"),
        "background": {"kind": "gradient", "gradient": {"from": "#0B1220", "to": "#16233C", "angle": 160}, "dim": 0.0},
    },
    "sapphire_dark": {
        "name": "Сапфир",
        "description": "Глубокий индиго и сталь — строгий тёмный образ",
        "default_mode": "dark",
        "surface_style": "soft",
        "radius": (10, 18),
        "fonts": (_MANROPE, _ONEST, 1.1),
        "swatch": ["#0A1020", "#5B7CE0", "#24305C"],
        "light": ("#2A3D8F", "#7C6BB0", "#F2F3FB", "#FFFFFF", "#161A2E"),
        "dark": ("#7E9BEA", "#B7A6E0", "#0A1020", "#141A2E", "#E9ECF8"),
        "background": {"kind": "gradient", "gradient": {"from": "#0A1020", "to": "#1B2450", "angle": 150}, "dim": 0.0},
    },
    "porcelain_navy": {
        "name": "Фарфор и синий",
        "description": "Светлая база, синий акцент — дневной люкс с тёмно-синим",
        "default_mode": "light",
        "surface_style": "soft",
        "radius": (12, 20),
        "fonts": (_MANROPE, _ONEST, 1.12),
        "swatch": ["#F4F6FB", "#1E4E8C", "#0C1420"],
        "light": ("#1E4E8C", "#9C7A4E", "#F4F6FB", "#FFFFFF", "#12202F"),
        "dark": ("#6EA8DC", "#C7A16A", "#0C1420", "#141F2E", "#E8EFF7"),
        "background": {"kind": "abstraction", "abstraction": "mesh", "dim": 0.06},
    },
    "harbor_light": {
        "name": "Гавань",
        "description": "Светлый день у воды, глубокий синий акцент",
        "default_mode": "light",
        "surface_style": "flat",
        "radius": (14, 22),
        "fonts": (_MANROPE, _ONEST, 1.08),
        "swatch": ["#EEF3FA", "#20558F", "#123B5C"],
        "light": ("#20558F", "#3E7CA8", "#EEF3FA", "#FFFFFF", "#123B5C"),
        "dark": ("#6BA6D8", "#79B4CE", "#0B1622", "#132433", "#E4EFF7"),
        "background": {"kind": "abstraction", "abstraction": "waves", "dim": 0.05},
    },
    # --- Наследие v1 (остаются в библиотеке как опции) ----------------------
    "evening_concierge": {
        "name": "Вечерний консьерж",
        "description": "Тёмная база, тёплое золото — спокойный вечерний люкс",
        "default_mode": "dark",
        "surface_style": "glass",
        "radius": (16, 24),
        "fonts": ("'Manrope', system-ui, sans-serif", "'Cormorant Garamond', Georgia, serif", 1.15),
        "swatch": ["#0E1B2A", "#C8A24A", "#16324A"],
        "light": ("#1D3B57", "#B8862F", "#F4F1EA", "#FFFFFF", "#17242F"),
        "dark": ("#C8A24A", "#8FB0C9", "#0E1B2A", "#16283A", "#EAF0F5"),
        "background": {"kind": "gradient", "gradient": {"from": "#0E1B2A", "to": "#16324A", "angle": 160}, "dim": 0.0},
    },
    "marble_linen": {
        "name": "Мрамор и лён",
        "description": "Светлый, тёплый камень и лён — дневной минимализм",
        "default_mode": "light",
        "surface_style": "soft",
        "radius": (14, 22),
        "fonts": ("'Golos Text', system-ui, sans-serif", "'Playfair Display', Georgia, serif", 1.1),
        "swatch": ["#F5F1EA", "#9C7A4E", "#2B2723"],
        "light": ("#8A6A3E", "#5F7A6B", "#F5F1EA", "#FFFFFF", "#2B2723"),
        "dark": ("#C7A16A", "#8FB0A0", "#1B1815", "#241F1B", "#EFE9E0"),
        "background": {"kind": "abstraction", "abstraction": "linen", "dim": 0.08},
    },
    "tiffany_night": {
        "name": "Тиффани-ночь",
        "description": "Глубокая бирюза на графите — свежо и статусно",
        "default_mode": "dark",
        "surface_style": "glass",
        "radius": (18, 28),
        "fonts": ("'Inter', system-ui, sans-serif", "'Inter', system-ui, sans-serif", 1.0),
        "swatch": ["#0B1417", "#3FB6A8", "#12262A"],
        "light": ("#0E8C7E", "#B4823C", "#EFF5F4", "#FFFFFF", "#10201E"),
        "dark": ("#3FB6A8", "#E0B96A", "#0B1417", "#12262A", "#E6F1EF"),
        "background": {"kind": "gradient", "gradient": {"from": "#0B1417", "to": "#123037", "angle": 150}, "dim": 0.0},
    },
    "azure_light": {
        "name": "Светлый лазурный",
        "description": "Воздушный день у воды — светло и приветливо",
        "default_mode": "light",
        "surface_style": "soft",
        "radius": (12, 20),
        "fonts": ("'Manrope', system-ui, sans-serif", "'Manrope', system-ui, sans-serif", 1.0),
        "swatch": ["#EAF3FB", "#2E86C1", "#153B5C"],
        "light": ("#2E86C1", "#E08A2B", "#EAF3FB", "#FFFFFF", "#153B5C"),
        "dark": ("#5BA9DE", "#E2A45A", "#0D1B29", "#132638", "#E6EFF7"),
        "background": {"kind": "abstraction", "abstraction": "waves", "dim": 0.05},
    },
}


def _build_tokens(code: str, seed: dict) -> dict:
    body, heading, scale = seed["fonts"]
    radius, radius_large = seed["radius"]
    palette = {
        mode: build_color_set(
            mode=mode,
            primary=seed[mode][0],
            secondary=seed[mode][1],
            background=seed[mode][2],
            surface=seed[mode][3],
            text=seed[mode][4],
        )
        for mode in ("light", "dark")
    }
    return {
        "preset": code,
        "palette": palette,
        "typography": _typography(body, heading, scale),
        "shape": {"borderRadius": radius, "borderRadiusLarge": radius_large},
        "spacingUnit": 8,
        "brand": {
            "logoLight": "",
            "logoDark": "",
            "surfaceStyle": seed["surface_style"],
            "defaultMode": seed["default_mode"],
            "background": seed["background"],
        },
    }


def preset_tokens(code: str) -> dict | None:
    seed = _PRESET_SEEDS.get(code)
    return _build_tokens(code, seed) if seed else None


def list_presets() -> list[dict]:
    return [
        {
            "code": code,
            "name": seed["name"],
            "description": seed["description"],
            "swatch": seed["swatch"],
            "default_mode": seed["default_mode"],
            "tokens": _build_tokens(code, seed),
        }
        for code, seed in _PRESET_SEEDS.items()
    ]


DEFAULT_PRESET = "evening_concierge"
