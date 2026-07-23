"""
Настройки коммерции отеля (A3+ шаги 5): сбор, налог, чаевые, доставка,
округление. Поля живут на существующей таблице `Hotel` — новых таблиц нет.

Валидация диапазонов здесь, а не только на клиенте: CMS-UI подсказывает, но
источник истины — сервер (тот же контракт, что у витрины).
"""

from __future__ import annotations

from typing import Any

from apps.core.errors import ValidationError
from apps.hotels.models import Hotel

# Базисные пункты: 10000 = 100%. Разумный потолок сбора/налога — 100%.
_MAX_BP = 10_000
# Пресеты чаевых — проценты; 100% чаевых уже за гранью здравого смысла.
_MAX_TIP_PERCENT = 100

_FIELDS = (
    "service_fee_bp",
    "tax_bp",
    "tax_inclusive",
    "tip_presets",
    "free_delivery_threshold_minor",
    "price_round_to_minor",
)


def serialize_commerce_settings(hotel: Hotel) -> dict[str, Any]:
    return {
        "service_fee_bp": hotel.service_fee_bp,
        "tax_bp": hotel.tax_bp,
        "tax_inclusive": hotel.tax_inclusive,
        "tip_presets": list(hotel.tip_presets or []),
        "free_delivery_threshold_minor": hotel.free_delivery_threshold_minor,
        "price_round_to_minor": hotel.price_round_to_minor,
        # Показатель степени валюты — чтобы UI делил/умножал суммы правильно.
        "currency": hotel.currency,
        "currency_minor_units": hotel.currency_minor_units,
    }


def _bp(value: Any, *, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > _MAX_BP:
        raise ValidationError(
            f"Значение должно быть от 0 до {_MAX_BP} базисных пунктов (0–100%)",
            field=field,
            code="out_of_range",
        )
    return value


def _non_negative(value: Any, *, field: str, allow_null: bool = False) -> int | None:
    if value is None:
        if allow_null:
            return None
        raise ValidationError("Обязательное поле", field=field)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("Ожидается неотрицательное целое", field=field, code="out_of_range")
    return value


def _tip_presets(value: Any) -> list[int]:
    if not isinstance(value, list):
        raise ValidationError("Ожидается список процентов", field="tip_presets")
    cleaned: list[int] = []
    for raw in value:
        if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0 or raw > _MAX_TIP_PERCENT:
            raise ValidationError(
                f"Пресет чаевых — целый процент от 0 до {_MAX_TIP_PERCENT}",
                field="tip_presets",
                code="out_of_range",
            )
        if raw not in cleaned:
            cleaned.append(raw)
    return cleaned


def update_commerce_settings(hotel: Hotel, data: dict[str, Any]) -> dict[str, Any]:
    """Частичное обновление: трогаем только присланные поля (PATCH-семантика)."""
    changed: list[str] = []

    if "service_fee_bp" in data:
        hotel.service_fee_bp = _bp(data["service_fee_bp"], field="service_fee_bp")
        changed.append("service_fee_bp")
    if "tax_bp" in data:
        hotel.tax_bp = _bp(data["tax_bp"], field="tax_bp")
        changed.append("tax_bp")
    if "tax_inclusive" in data:
        if not isinstance(data["tax_inclusive"], bool):
            raise ValidationError("Ожидается true/false", field="tax_inclusive")
        hotel.tax_inclusive = data["tax_inclusive"]
        changed.append("tax_inclusive")
    if "tip_presets" in data:
        hotel.tip_presets = _tip_presets(data["tip_presets"])
        changed.append("tip_presets")
    if "free_delivery_threshold_minor" in data:
        hotel.free_delivery_threshold_minor = _non_negative(
            data["free_delivery_threshold_minor"],
            field="free_delivery_threshold_minor",
            allow_null=True,
        )
        changed.append("free_delivery_threshold_minor")
    if "price_round_to_minor" in data:
        hotel.price_round_to_minor = _non_negative(
            data["price_round_to_minor"], field="price_round_to_minor"
        )
        changed.append("price_round_to_minor")

    if changed:
        hotel.save(update_fields=[*changed, "updated_at"])
    return serialize_commerce_settings(hotel)
