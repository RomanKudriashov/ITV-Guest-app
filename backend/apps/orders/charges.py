"""
Расчёт начислений заказа — чистая функция сервисного слоя.

Всё в минимальных единицах, ставки в базисных пунктах (1000 = 10.00%). Расчёт
детерминирован и не трогает БД: create_order считает разбивку, фиксирует её
снимком в заказе, а предпросчёт корзины зовёт ту же функцию, ничего не создавая.
Пока коммерция у отеля выключена (всё по нулям), total == subtotal — поведение
старых заказов не меняется.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class ChargeBreakdown:
    subtotal_minor: int
    service_fee_minor: int
    tax_minor: int
    delivery_fee_minor: int
    tip_minor: int
    total_minor: int
    charges: dict  # снимок ставок/флагов на момент расчёта

    def as_dict(self) -> dict:
        return {
            "subtotal_minor": self.subtotal_minor,
            "service_fee_minor": self.service_fee_minor,
            "tax_minor": self.tax_minor,
            "delivery_fee_minor": self.delivery_fee_minor,
            "tip_minor": self.tip_minor,
            "total_minor": self.total_minor,
        }


def _round_to(value: int, step: int) -> int:
    if not step or step <= 1:
        return value
    return int(round(value / step) * step)


def compute_charges(
    hotel,
    *,
    priced_lines: list[tuple[int, bool]],
    location=None,
    tip_minor: int = 0,
) -> ChargeBreakdown:
    """
    priced_lines — список (line_total_minor, облагается_ли_сбором) по позициям.
    location — локация доставки (для стоимости доставки), может быть None.
    """
    subtotal = sum(lt for lt, _ in priced_lines if lt)
    feeable = sum(lt for lt, applies in priced_lines if lt and applies)

    service_fee = feeable * int(hotel.service_fee_bp or 0) // 10000

    delivery_conf = int(getattr(location, "delivery_fee_minor", 0) or 0) if location else 0
    delivery = delivery_conf
    threshold = hotel.free_delivery_threshold_minor
    if threshold is not None and subtotal >= threshold:
        delivery = 0

    tax_bp = int(hotel.tax_bp or 0)
    if hotel.tax_inclusive:
        # Налог уже в цене — показываем «в т.ч.», к итогу не прибавляем.
        tax = subtotal - (subtotal * 10000 // (10000 + tax_bp)) if tax_bp else 0
        tax_added = 0
    else:
        tax = (subtotal + service_fee + delivery) * tax_bp // 10000
        tax_added = tax

    tip = max(int(tip_minor or 0), 0)

    total = _round_to(subtotal + service_fee + delivery + tax_added + tip, int(hotel.price_round_to_minor or 0))

    snapshot = {
        "service_fee_bp": int(hotel.service_fee_bp or 0),
        "tax_bp": tax_bp,
        "tax_inclusive": bool(hotel.tax_inclusive),
        "delivery_fee_minor": delivery_conf,
        "delivery_free_by_threshold": bool(delivery_conf and delivery == 0),
        "free_delivery_threshold_minor": threshold,
        "price_round_to_minor": int(hotel.price_round_to_minor or 0),
    }
    return ChargeBreakdown(subtotal, service_fee, tax, delivery, tip, total, snapshot)


def minimum_order_minor(categories, execution_point) -> int:
    """Порог минимума = максимум из порогов категорий заказа и точки исполнения."""
    mins = [int(c.min_order_minor) for c in categories if getattr(c, "min_order_minor", None)]
    ep_min = getattr(execution_point, "min_order_minor", None)
    if ep_min:
        mins.append(int(ep_min))
    return max(mins) if mins else 0


def resolve_tip_minor(*, subtotal_minor: int, tip_minor: int | None, tip_percent: float | None) -> int:
    """Чаевые: либо своя сумма, либо процент от суммы позиций."""
    if tip_minor:
        return max(int(tip_minor), 0)
    if tip_percent:
        return max(int(subtotal_minor * float(tip_percent) / 100), 0)
    return 0
