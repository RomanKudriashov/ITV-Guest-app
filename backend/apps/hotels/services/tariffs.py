"""
Тарифы платформы: что тариф ОТКРЫВАЕТ и чего НЕ ДЕЛАЕТ.

Тариф решает две вещи и только их: набор модулей по умолчанию и лимиты
использования. Денег он не двигает — это шов под будущий биллинг, а не биллинг:
здесь нет ни сумм, ни периодов оплаты, ни счетов. Дата окончания триала —
календарная пометка, по которой платформа сама решает, что делать; никакого
автосписания за ней не стоит.

Реестр объявлен КОДОМ, а не таблицей, осознанно: тарифная сетка — это продукт
платформы, она меняется вместе с релизом и должна быть видна в диффе и покрыта
тестами. Таблица дала бы возможность править её мимо ревью, а с ней и
расхождение между тем, что открыто отелю, и тем, что заявлено тарифом.

Связь с реестром модулей (R1) односторонняя: тариф даёт НАБОР ПО УМОЛЧАНИЮ,
строки HotelModule — фактическое состояние. Точечное переопределение (выдать
фичу вне тарифа, например пилоту) живёт в строке модуля и тариф не переписывает.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from apps.hotels.models import HotelModule

C = HotelModule.Code


@dataclass(frozen=True)
class Limits:
    """
    Потолки использования. None — «без лимита»: у курортного тарифа их нет, и
    ноль здесь означал бы «ничего нельзя», а не «сколько угодно».
    """

    services: int | None = None
    rooms: int | None = None
    staff: int | None = None


@dataclass(frozen=True)
class Tariff:
    code: str
    title: dict[str, str]
    modules: list[str] = field(default_factory=list)
    limits: Limits = field(default_factory=Limits)
    # Триальный тариф ограничен по времени: у отеля на нём обязана быть дата
    # окончания, и платформа показывает её в сводке заранее.
    is_trial: bool = False
    trial_days: int = 0


TARIFFS: dict[str, Tariff] = {
    "standard": Tariff(
        code="standard",
        title={"ru": "Standard", "en": "Standard", "ar": "Standard", "zh": "Standard"},
        modules=[],
        limits=Limits(services=1, rooms=30, staff=15),
    ),
    "business": Tariff(
        code="business",
        title={"ru": "Business", "en": "Business", "ar": "Business", "zh": "Business"},
        modules=[C.MULTI_RESTAURANT, C.ROOM_CONTROL, C.MARKETING, C.ANALYTICS_LEVEL],
        limits=Limits(services=5, rooms=200, staff=80),
    ),
    "resort": Tariff(
        code="resort",
        title={"ru": "Resort", "en": "Resort", "ar": "Resort", "zh": "Resort"},
        modules=[
            C.MULTI_RESTAURANT,
            C.ROOM_CONTROL,
            C.MARKETING,
            C.ANALYTICS_LEVEL,
            C.PMS,
            C.MOBILE_KEY,
            C.EXTRA_LANGUAGES,
        ],
        limits=Limits(),  # без лимита
    ),
    "trial": Tariff(
        code="trial",
        title={"ru": "Триал", "en": "Trial", "ar": "تجريبي", "zh": "试用"},
        # Триал — это Business на срок: иначе он не показывает продукт целиком,
        # и отель решает, покупать ли, посмотрев не то, что купит.
        modules=[C.MULTI_RESTAURANT, C.ROOM_CONTROL, C.MARKETING, C.ANALYTICS_LEVEL],
        limits=Limits(services=5, rooms=200, staff=80),
        is_trial=True,
        trial_days=14,
    ),
}

DEFAULT_TARIFF = "standard"


def get(code: str | None) -> Tariff:
    """Тариф по коду. Неизвестный или пустой — базовый, а не падение."""
    return TARIFFS.get((code or "").strip().lower(), TARIFFS[DEFAULT_TARIFF])


def codes() -> list[str]:
    return list(TARIFFS)


def modules_for(code: str | None) -> set[str]:
    return set(get(code).modules)


def trial_days_left(hotel, today: date | None = None) -> int | None:
    """
    Сколько дней триала осталось. None — отель не на триале либо дата не
    проставлена (тариф ставится руками, и «забыли дату» — обычное состояние,
    а не ошибка, которой нужно падать).
    """
    if not get(hotel.tariff).is_trial or not hotel.trial_ends_at:
        return None
    reference = today or hotel.local_now().date()
    return (hotel.trial_ends_at - reference).days
