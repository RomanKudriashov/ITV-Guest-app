"""
Выезд гостя, отмеченный руками.

ЗАЧЕМ ОТДЕЛЬНОЕ ДЕЙСТВИЕ. Выезда у нас не видно вовсе: PMS-интеграции нет,
сессия живёт `GUEST_SESSION_TTL_HOURS` и продлевается новым входом по номеру
комнаты, который знает кто угодно. Единственным способом отобрать доступ была
СМЕНА PIN — то есть побочный эффект другого действия. Ресепшен при этом решает
задачу «гость съехал», а нажимает «сменить код»: если код менять не собирались,
доступ у выехавшего оставался.

ЭТО НЕ ПРО УПРАВЛЕНИЕ НОМЕРОМ. Отзыв гасит гостевые сессии целиком — вместе с
корзиной, историей заказов на устройстве и правом заказывать. Поэтому действие
живёт здесь, в `accounts`, а не в модуле GRMS: отелю без оборудования выезд
нужен ровно так же.

ЧЕСТНОСТЬ ГРАНИЦ. Мы не знаем, кто именно съехал, и не притворяемся: гасим ВСЕ
живые сессии комнаты. Гость, который на самом деле остался, входит заново одним
сканированием QR — это дешевле, чем оставить доступ уехавшему.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from apps.core.models import AuditLog

# Домен `guest_session`, а не `guest`: событие про сессии, и рядом с
# `guest_session.created` оно читается как продолжение той же истории. Плюс
# сторож кодов событий смотрит именно на этот список доменов — код из чужого
# домена доехал бы до глаз оператора непереведённым.
ACTION = "guest_session.checked_out"


@dataclass(slots=True)
class CheckoutResult:
    """Сколько сессий погашено и сколько из них были подтверждёнными."""

    revoked: int
    verified_revoked: int


def check_out_room(hotel, room, *, actor_id=None) -> CheckoutResult:
    """
    Отметить выезд: отозвать все живые сессии комнаты.

    Подтверждение PIN живёт полем на сессии, поэтому отдельно гасить его не
    нужно — отозванная сессия не проходит аутентификацию вовсе, и её признак
    подтверждения уже ничего не значит. Но СЧИТАЕМ мы его отдельно: «отозвано
    три, из них одна управляла номером» — разные новости для администратора.
    """
    from apps.accounts.models import GuestSession

    now = timezone.now()
    live = GuestSession.objects.filter(
        room=room, revoked_at__isnull=True, expires_at__gt=now
    )
    verified_revoked = live.filter(room_verified_at__isnull=False).count()
    revoked = live.update(revoked_at=now, updated_at=now)

    AuditLog.record(
        # Литералом, а не переменной: сторож кодов событий ищет строку в вызове
        # журнала, и код, спрятанный за именем, он не увидит.
        "guest_session.checked_out",
        actor_type=AuditLog.ActorType.STAFF,
        actor_id=actor_id,
        object_type="hotels.room",
        object_id=room.pk,
        payload={
            "room": room.number,
            "revoked": revoked,
            "verified_revoked": verified_revoked,
        },
        hotel_id=hotel.pk,
    )
    return CheckoutResult(revoked=revoked, verified_revoked=verified_revoked)
