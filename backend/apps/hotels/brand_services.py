"""
Сервисный слой бренд-настроек.

Отель правит токены частичным PATCH — сервер валидирует и мержит поверх
текущих. Валидация здесь не косметика: токены уходят на витрину как есть, и
кривой цвет или чужой шрифт увидел бы гость.
"""

from __future__ import annotations

import re
from typing import Any

from django.utils import timezone

from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError, ValidationError

from .brand_library import (
    ABSTRACTION_CODES,
    BACKGROUND_KINDS,
    DEFAULT_MODES,
    DEFAULT_PRESET,
    FONT_FAMILIES,
    SURFACE_STYLES,
    preset_tokens,
)
from .models import BrandTheme, Hotel

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_RGBA = re.compile(r"^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[01](?:\.\d+)?\s*)?\)$")


# --- Получение темы отеля --------------------------------------------------


def get_or_create_brand(hotel: Hotel | None = None) -> BrandTheme:
    """
    Тема отеля по умолчанию. Если её нет (старый отель) — заводим из пресета,
    чтобы витрина не осталась на платформенных цветах.
    """
    hotel = hotel or Hotel.objects.get(pk=require_hotel_id())
    if hotel.default_theme_id:
        theme = BrandTheme.objects.filter(pk=hotel.default_theme_id).first()
        if theme is not None:
            return theme

    theme = BrandTheme.objects.create(
        name=f"{hotel.name} — основная", tokens=preset_tokens(DEFAULT_PRESET)
    )
    Hotel.objects.filter(pk=hotel.pk).update(default_theme=theme)
    hotel.default_theme = theme
    return theme


def serialize_brand(theme: BrandTheme) -> dict:
    tokens = theme.tokens or {}
    return {
        "id": str(theme.pk),
        "name": theme.name,
        "preset": tokens.get("preset", "custom"),
        "tokens": tokens,
        "updated_at": theme.updated_at.isoformat(),
    }


# --- Валидация -------------------------------------------------------------


def _is_color(value: Any) -> bool:
    return isinstance(value, str) and bool(_HEX.match(value) or _RGBA.match(value.strip()))


def _validate_colors(palette: dict, *, path: str) -> None:
    for mode in ("light", "dark"):
        for key, value in (palette.get(mode) or {}).items():
            if not _is_color(value):
                raise ValidationError(
                    f"Некорректный цвет: {value}",
                    field=f"{path}.{mode}.{key}",
                    code="invalid_color",
                )


def _validate_typography(typography: dict) -> None:
    for key in ("fontFamily", "headingFontFamily"):
        family = typography.get(key)
        if family and family not in FONT_FAMILIES:
            raise ValidationError(
                f"Шрифт не из списка: {family}",
                field=f"typography.{key}",
                code="font_not_allowed",
            )


def _validate_brand_section(brand: dict) -> None:
    style = brand.get("surfaceStyle")
    if style is not None and style not in SURFACE_STYLES:
        raise ValidationError(f"Неизвестный стиль поверхностей: {style}", field="brand.surfaceStyle")

    mode = brand.get("defaultMode")
    if mode is not None and mode not in DEFAULT_MODES:
        raise ValidationError(f"Неизвестный режим по умолчанию: {mode}", field="brand.defaultMode")

    background = brand.get("background")
    if background is not None:
        _validate_background(background)


def _validate_background(background: dict) -> None:
    kind = background.get("kind")
    if kind is not None and kind not in BACKGROUND_KINDS:
        raise ValidationError(f"Неизвестный тип фона: {kind}", field="brand.background.kind")

    color = background.get("color")
    if color and not _is_color(color):
        raise ValidationError(f"Некорректный цвет фона: {color}", field="brand.background.color", code="invalid_color")

    gradient = background.get("gradient") or {}
    for stop in ("from", "to"):
        if gradient.get(stop) and not _is_color(gradient[stop]):
            raise ValidationError(
                f"Некорректный цвет градиента: {gradient[stop]}",
                field=f"brand.background.gradient.{stop}",
                code="invalid_color",
            )

    if background.get("abstraction") and background["abstraction"] not in ABSTRACTION_CODES:
        raise ValidationError(
            f"Неизвестная абстракция: {background['abstraction']}",
            field="brand.background.abstraction",
        )

    dim = background.get("dim")
    if dim is not None and not (isinstance(dim, (int, float)) and 0 <= dim <= 1):
        raise ValidationError("Затемнение должно быть от 0 до 1", field="brand.background.dim")


def validate_tokens_patch(patch: dict) -> None:
    if "palette" in patch:
        _validate_colors(patch["palette"], path="palette")
    if "typography" in patch:
        _validate_typography(patch["typography"])
    if "brand" in patch:
        _validate_brand_section(patch["brand"])


# --- Обновление ------------------------------------------------------------


def _deep_merge(base: dict, patch: dict) -> dict:
    """Рекурсивный merge: словари сливаются, остальное перезаписывается."""
    result = dict(base)
    for key, value in (patch or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def update_brand(patch_tokens: dict) -> BrandTheme:
    theme = get_or_create_brand()
    validate_tokens_patch(patch_tokens)

    merged = _deep_merge(theme.tokens or {}, patch_tokens)

    # Любая ручная правка снимает ярлык пресета: набор больше не «чистый».
    # Исключение — если сам preset пришёл в патче (это применение пресета).
    if "preset" not in patch_tokens and patch_tokens:
        merged["preset"] = "custom"

    theme.tokens = merged
    theme.save(update_fields=["tokens", "updated_at"])
    return theme


def apply_preset(code: str) -> BrandTheme:
    """
    Замена токенов целиком набором пресета. Отдельно от PATCH намеренно: смысл
    не «поправить», а «начать с чистого набора», и мержить старые правки поверх
    нового пресета было бы сюрпризом.
    """
    tokens = preset_tokens(code)
    if tokens is None:
        raise NotFoundError(f"Пресет «{code}» не найден", code="unknown_preset")

    theme = get_or_create_brand()
    # Сохраняем уже загруженные логотипы: пресет их не несёт, а терять их при
    # смене палитры отель не ожидает.
    existing_brand = (theme.tokens or {}).get("brand", {})
    tokens["brand"]["logoLight"] = existing_brand.get("logoLight", "")
    tokens["brand"]["logoDark"] = existing_brand.get("logoDark", "")

    theme.tokens = tokens
    theme.save(update_fields=["tokens", "updated_at"])
    return theme
