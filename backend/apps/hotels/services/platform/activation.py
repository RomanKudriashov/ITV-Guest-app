"""
Отключение и включение отеля (партия 62-C, решения Олега).

Отключённый отель:
  * гость — заглушка в бренде отеля «Отель временно не принимает заказы»,
    гостевые API — 423 без причины, гостевые сессии завершены, сокеты закрыты,
    команды номера не уходят (коннектор остаётся подключённым);
  * сотрудник — сессии отозваны, форма входа видна, вход — «Вход недоступен»;
  * Control — пометка «отключён»: причина, кем, когда, дата авто-включения.

ПРИЧИНУ ВИДИТ ТОЛЬКО CONTROL. Она лежит в полях отеля, которые отдаёт лишь
платформенная карточка, и в журнале отеля — откуда её вырезают все выдачи,
кроме консольной (`REASON_ACTIONS`).

Одна логика на всех: карточка, массовое действие «Отелей» и действие группы
зовут ЭТИ функции, а не пишут `is_active` сами.
"""

from __future__ import annotations

from datetime import date, datetime, time
from datetime import timezone as dt_timezone

from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.hotels.models import Hotel

JOB_KIND = "hotel.enable"
# Записи журнала, в которых лежит причина: их payload видит только Control.
REASON_ACTIONS = ("platform.hotel.deactivated",)


def _clean_reason(reason: str | None) -> str:
    text = (reason or "").strip()
    if not text:
        raise ValidationError(
            "Укажите причину отключения — её увидит только команда платформы",
            field="reason",
            code="reason_required",
        )
    return text[:1000]


def _clean_enable_on(hotel: Hotel, value) -> date | None:
    if not value:
        return None
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value)
        except ValueError as exc:
            raise ValidationError("Дата включения — в виде ГГГГ-ММ-ДД", field="enable_on", code="bad_date") from exc
    today = timezone.now().astimezone(hotel.tzinfo).date()
    if value <= today:
        raise ValidationError(
            "Дата авто-включения — не раньше завтрашнего дня",
            field="enable_on",
            code="enable_on_past",
        )
    return value


@transaction.atomic
def disable(
    hotel: Hotel, *, reason: str, enable_on=None, actor_id=None, ip: str | None = None, extra: dict | None = None
) -> Hotel:
    """Отключить отель. Уже отключённый — обновить причину и дату."""
    from apps.accounts.services import sessions as session_svc
    from apps.hotels.services.platform import console

    text = _clean_reason(reason)
    day = _clean_enable_on(hotel, enable_on)
    was_active = hotel.is_active
    hotel.is_active = False
    hotel.disabled_reason = text
    hotel.disabled_at = hotel.disabled_at if not was_active and hotel.disabled_at else timezone.now()
    hotel.disabled_by = actor_id
    hotel.enable_on = day
    hotel.save(update_fields=["is_active", "disabled_reason", "disabled_at", "disabled_by", "enable_on", "updated_at"])

    session_svc.revoke_hotel(hotel.pk, reason="hotel_deactivated")
    _end_guest_sessions(hotel)
    _reschedule(hotel, day)

    console.audit_hotel(
        hotel,
        "platform.hotel.deactivated",
        actor_id=actor_id,
        ip=ip,
        payload={"reason": text, "enable_on": day.isoformat() if day else None, **(extra or {})},
    )
    return hotel


@transaction.atomic
def enable(
    hotel: Hotel, *, actor_id=None, ip: str | None = None, auto: bool = False, extra: dict | None = None
) -> Hotel:
    """Включить отель. Причина и дата стираются — история остаётся в журнале."""
    from apps.hotels.services.platform import console

    if hotel.is_active:
        return hotel
    hotel.is_active = True
    hotel.disabled_reason = ""
    hotel.disabled_at = None
    hotel.disabled_by = None
    hotel.enable_on = None
    hotel.save(update_fields=["is_active", "disabled_reason", "disabled_at", "disabled_by", "enable_on", "updated_at"])
    _reschedule(hotel, None)
    payload = {**({"auto": True} if auto else {}), **(extra or {})}
    console.audit_hotel(hotel, "platform.hotel.activated", actor_id=actor_id, ip=ip, payload=payload or None)
    return hotel


def _end_guest_sessions(hotel: Hotel) -> int:
    """Гостевые сессии завершаются, открытые гостевые сокеты закрываются."""
    from apps.accounts.models import GuestSession
    from apps.core.context import platform_scope
    from apps.realtime.sessions import close_hotel_guests

    now = timezone.now()
    with platform_scope():
        count = (
            GuestSession.all_objects.using("platform")
            .filter(hotel_id=hotel.pk, revoked_at__isnull=True)
            .update(revoked_at=now, updated_at=now)
        )
    close_hotel_guests(hotel.pk)
    return count


def _reschedule(hotel: Hotel, day: date | None) -> None:
    """Одно задание авто-включения на отель: прежнее отменяется, новое — на начало дня отеля."""
    from apps.core.models_scheduler import ScheduledJob
    from apps.core.services import scheduler

    with tenant_context(hotel):
        for job in ScheduledJob.objects.filter(kind=JOB_KIND, status=ScheduledJob.Status.PENDING):
            scheduler.cancel(job.pk)
        if day is not None:
            local = datetime.combine(day, time(0, 0), tzinfo=hotel.tzinfo)
            scheduler.schedule(kind=JOB_KIND, run_at=local.astimezone(dt_timezone.utc), payload={"enable_on": day.isoformat()})


def run_enable_job(job) -> dict:
    """Обработчик планировщика: включить, если отель всё ещё ждёт ЭТУ дату."""
    hotel = Hotel.objects.filter(pk=job.hotel_id).first()
    if hotel is None or hotel.is_active:
        return {"skipped": True, "reason": "already_active"}
    if not hotel.enable_on or hotel.enable_on.isoformat() != job.payload.get("enable_on"):
        return {"skipped": True, "reason": "date_changed"}
    enable(hotel, auto=True)
    return {"enabled": True}


def disabled_info(hotel: Hotel) -> dict | None:
    """Пометка «отключён» для Control: причина, кем, когда, дата авто-включения."""
    if hotel.is_active:
        return None
    by = ""
    if hotel.disabled_by:
        from apps.accounts.models import User
        from apps.core.context import platform_scope

        with platform_scope():
            user = User.all_objects.using("platform").filter(pk=hotel.disabled_by).first()
        by = (user.full_name or user.email) if user else ""
    return {
        "reason": hotel.disabled_reason,
        "at": hotel.disabled_at.isoformat() if hotel.disabled_at else None,
        "by": by,
        "enable_on": hotel.enable_on.isoformat() if hotel.enable_on else None,
    }
