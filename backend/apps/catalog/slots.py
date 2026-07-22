"""
Слоты: расчёт доступности и транзакционная бронь.

Изолировано в своём модуле, вызывается по флагу behaviour.uses_slots — ядро
заказа про слоты не знает. Здесь же живёт защита от двойной брони, ради
которой весь тип и написан.

Всё во времени отеля: «слот на 10:00» — это 10:00 у отеля, а не на сервере.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from apps.core.errors import ConflictError, ValidationError
from apps.core.fields import translate

from .models import Item, SlotBooking, SlotConfig


class SlotError(ValidationError):
    code = "slot_error"


class SlotTaken(ConflictError):
    code = "slot_taken"


# --- Доступность -----------------------------------------------------------


@dataclasses.dataclass(slots=True)
class Slot:
    starts_at: datetime
    ends_at: datetime
    capacity_left: int

    @property
    def available(self) -> bool:
        return self.capacity_left > 0


def _config(item: Item) -> SlotConfig:
    config = (
        SlotConfig.objects.select_related("schedule", "execution_point")
        .prefetch_related("schedule__intervals")
        .filter(item=item)
        .first()
    )
    if config is None:
        raise SlotError("Для этой позиции не настроена бронь", field="item_id", code="slot_not_configured")
    return config


def _candidate_starts(config: SlotConfig, local_date, tzinfo) -> list[datetime]:
    """
    Нарезает рабочие часы дня на слоты длиной duration_minutes.

    Шаг = длительность слота: сетка без нахлёстов, начала предсказуемы (10:00,
    11:00…), что и нужно, чтобы бронь совпадала со слотом байт-в-байт.
    """
    weekday = local_date.weekday()
    step = timedelta(minutes=config.duration_minutes)
    starts: list[datetime] = []

    for interval in config.schedule.intervals.all():
        if interval.weekday != weekday:
            continue
        cursor = datetime.combine(local_date, interval.start_time, tzinfo=tzinfo)
        end = datetime.combine(local_date, interval.end_time, tzinfo=tzinfo)
        if interval.end_time <= interval.start_time:
            end += timedelta(days=1)  # интервал через полночь
        while cursor + step <= end:
            starts.append(cursor)
            cursor += step
    return sorted(set(starts))


def available_slots(item: Item, date_str: str) -> dict:
    from apps.hotels.models import Hotel

    config = _config(item)
    hotel = Hotel.objects.get(pk=item.hotel_id)
    tzinfo = hotel.tzinfo

    try:
        local_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise SlotError("Дата в формате ГГГГ-ММ-ДД", field="date") from None

    starts = _candidate_starts(config, local_date, tzinfo)
    now = timezone.now()
    earliest = now + timedelta(minutes=config.lead_minutes)
    horizon = now + timedelta(days=config.horizon_days)

    booked = _booked_counts(item, starts)
    slots = []
    for start in starts:
        end = start + timedelta(minutes=config.duration_minutes)
        left = config.capacity - booked.get(start, 0)
        in_window = earliest <= start <= horizon
        slots.append(
            {
                "starts_at": start.isoformat(),
                "ends_at": end.isoformat(),
                "capacity_left": max(left, 0),
                "available": left > 0 and in_window,
            }
        )

    return {
        "date": date_str,
        "duration_minutes": config.duration_minutes,
        "capacity": config.capacity,
        "slots": slots,
    }


def _booked_counts(item: Item, starts: list[datetime]) -> dict[datetime, int]:
    if not starts:
        return {}
    counts: dict[datetime, int] = {}
    rows = SlotBooking.objects.filter(
        item=item, is_active=True, starts_at__in=starts
    ).values_list("starts_at", flat=True)
    for start in rows:
        counts[start] = counts.get(start, 0) + 1
    return counts


# --- Бронь -----------------------------------------------------------------


def validate_and_reserve(item: Item, slot_start_raw, *, order) -> SlotBooking:
    """
    Проверяет слот и создаёт бронь ПОД БЛОКИРОВКОЙ.

    Защита от двойной брони: select_for_update на строке SlotConfig сериализует
    одновременные брони одного ресурса. Проверка вместимости внутри блокировки
    не может быть обогнана — два гостя за последний слот: успевает один, второй
    получает slot_taken. Вызывается уже внутри transaction.atomic создания
    заказа, поэтому откат заказа откатывает и бронь.
    """
    if not slot_start_raw:
        raise SlotError("Выберите время брони", field="slot_start", code="slot_required")

    start = _parse_start(slot_start_raw)

    # Блокируем конфиг ресурса — это и есть точка сериализации.
    config = SlotConfig.objects.select_for_update().select_related("schedule").filter(item=item).first()
    if config is None:
        raise SlotError("Для этой позиции не настроена бронь", field="item_id", code="slot_not_configured")

    _check_offered(config, item, start)
    _check_window(config, start)

    active = SlotBooking.objects.filter(item=item, starts_at=start, is_active=True).count()
    if active >= config.capacity:
        raise SlotTaken("Этот слот только что заняли — выберите другой")

    return SlotBooking.objects.create(
        hotel_id=item.hotel_id,
        item=item,
        order=order,
        starts_at=start,
        ends_at=start + timedelta(minutes=config.duration_minutes),
        is_active=True,
    )


def _parse_start(raw) -> datetime:
    if isinstance(raw, datetime):
        start = raw
    else:
        parsed = timezone.datetime.fromisoformat(str(raw)) if _isoformat_ok(raw) else None
        if parsed is None:
            raise SlotError("Некорректное время слота", field="slot_start", code="slot_bad_time")
        start = parsed
    if timezone.is_naive(start):
        start = timezone.make_aware(start)
    return start


def _isoformat_ok(raw) -> bool:
    try:
        timezone.datetime.fromisoformat(str(raw))
        return True
    except ValueError:
        return False


def _check_offered(config: SlotConfig, item: Item, start: datetime) -> None:
    """Слот обязан совпадать с рабочей сеткой — не «любое время»."""
    from apps.hotels.models import Hotel

    hotel = Hotel.objects.get(pk=item.hotel_id)
    local = start.astimezone(hotel.tzinfo)
    if local not in _candidate_starts(config, local.date(), hotel.tzinfo):
        raise SlotError(
            "Это время не предлагается к брони", field="slot_start", code="slot_not_offered"
        )


def _check_window(config: SlotConfig, start: datetime) -> None:
    now = timezone.now()
    if start < now + timedelta(minutes=config.lead_minutes):
        raise SlotError("Слот уже в прошлом", field="slot_start", code="slot_in_past")
    if start > now + timedelta(days=config.horizon_days):
        raise SlotError(
            "Так далеко вперёд бронь ещё не открыта", field="slot_start", code="slot_in_past"
        )


def release_bookings(order) -> int:
    """Отмена заказа освобождает слот: активные брони гасятся."""
    return SlotBooking.objects.filter(order=order, is_active=True).update(is_active=False)


# --- Сериализация для карточки/трекера -------------------------------------


def serialize_slot(order, language: str | None = None) -> dict | None:
    booking = order.slot_bookings.filter(is_active=True).select_related("item").first()
    if booking is None:
        # Отменённая бронь: показываем последний слот, помечая что он снят.
        booking = order.slot_bookings.select_related("item").order_by("-created_at").first()
    if booking is None:
        return None

    config = SlotConfig.objects.filter(item=booking.item).first()
    hotel = order.hotel
    return {
        "resource_title": translate(booking.item.title, language),
        "starts_at": hotel.to_local(booking.starts_at).isoformat(),
        "ends_at": hotel.to_local(booking.ends_at).isoformat(),
        "duration_minutes": config.duration_minutes if config else None,
        "is_active": booking.is_active,
    }
