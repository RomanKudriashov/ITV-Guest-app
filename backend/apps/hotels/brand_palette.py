"""
Построитель палитры из опорных цветов.

Полный набор токенов — 18 цветов на режим. Писать их руками для каждого
пресета значило бы плодить рассогласованные оттенки; вместо этого пресет
задаёт 4-5 опорных цветов, а производные (приглушённые поверхности, ховеры,
делители, скримы) выводятся отсюда. Один смысловой сдвиг — один расчёт, а не
восемнадцать ручных подборов.

Все преобразования — в пространстве sRGB со смешиванием к белому/чёрному. Для
UI-палитры этого достаточно; уходить в OKLCH ради подложек меню незачем.
"""

from __future__ import annotations


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def _rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c))):02X}" for c in rgb)


def _mix(color: str, other: str, weight: float) -> str:
    """weight — доля второго цвета: mix(a, b, 0.1) = 90% a + 10% b."""
    a, b = _hex_to_rgb(color), _hex_to_rgb(other)
    return _rgb_to_hex(tuple(a[i] * (1 - weight) + b[i] * weight for i in range(3)))


def _relative_luminance(color: str) -> float:
    r, g, b = (c / 255 for c in _hex_to_rgb(color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_on(color: str, *, dark_text: str = "#12211D", light_text: str = "#FFFFFF") -> str:
    """Читаемый текст на заливке — тёмный или светлый по яркости фона."""
    return dark_text if _relative_luminance(color) > 0.55 else light_text


def _linear_channel(value: float) -> float:
    value /= 255
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def _wcag_luminance(color: str) -> float:
    r, g, b = _hex_to_rgb(color)
    return 0.2126 * _linear_channel(r) + 0.7152 * _linear_channel(g) + 0.0722 * _linear_channel(b)


def contrast_ratio(a: str, b: str) -> float:
    """Контраст по WCAG: (L1+0.05)/(L2+0.05). Только hex-цвета (не rgba)."""
    la, lb = _wcag_luminance(a), _wcag_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def build_color_set(
    *,
    mode: str,
    primary: str,
    secondary: str,
    background: str,
    surface: str,
    text: str,
) -> dict[str, str]:
    """
    Разворачивает опорные цвета в полный BrandColorSet.

    Направление смешивания зависит от режима: в светлой теме поверхности
    осветляются к белому и текст затемняется, в тёмной — наоборот. Так один и
    тот же набор опорных цветов даёт корректную иерархию в обоих режимах.
    """
    is_dark = mode == "dark"
    lift = "#FFFFFF" if not is_dark else "#0A0F0D"     # куда «поднимать» поверхности
    sink = text                                          # куда уводить делители/скримы

    return {
        "primary": primary,
        "primaryContrast": contrast_on(primary),
        "secondary": secondary,
        "secondaryContrast": contrast_on(secondary),
        "background": background,
        "surface": surface,
        # Приглушённая поверхность — на шаг от surface к фону/тексту.
        "surfaceMuted": _mix(surface, background if not is_dark else lift, 0.5),
        "surfaceHover": _mix(surface, primary, 0.06),
        "surfaceSelected": _mix(surface, primary, 0.14),
        "scrim": _rgba(background, 0.55) if not is_dark else _rgba("#000000", 0.65),
        "dropActive": _mix(surface, primary, 0.18),
        "text": text,
        "textSecondary": _mix(text, surface, 0.42),
        "divider": _mix(surface, sink, 0.14),
        "success": "#2E7D32" if not is_dark else "#66BB6A",
        "warning": "#ED6C02" if not is_dark else "#FFA726",
        "error": "#C62828" if not is_dark else "#EF5350",
        "info": "#0277BD" if not is_dark else "#29B6F6",
    }


def _rgba(color: str, alpha: float) -> str:
    r, g, b = _hex_to_rgb(color)
    return f"rgba({r}, {g}, {b}, {alpha})"
