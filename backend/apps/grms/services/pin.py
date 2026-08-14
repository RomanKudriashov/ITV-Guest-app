"""
PIN проживания: step-up доверия для управления номером.

Защита от перебора — ЧАСТЬ КОНТРАКТА, а не деталь реализации (guest-api.md §2).
Четыре цифры это 10 000 вариантов; без счётчика попыток такой PIN не защищает
ни от чего, и «реализовали PIN» означало бы ровно ноль.

Счётчик ведётся И на комнату, И на устройство. Только на устройство — бесплатно
обнуляется новой сессией (её выдают по одному QR-сканированию). Только на
комнату — позволяет одному соседу заблокировать вход настоящему гостю; поэтому
на комнату порог выше и держится он вместе с устройством, а не вместо.

Ответ на неверный PIN — константного времени и без подсказок: «такой брони
нет» против «PIN не тот» это готовый оракул для перебора. Когда PIN номеру не
заведён вовсе, мы всё равно тратим то же время на проверку заведомо не
подходящего хэша.

PIN не попадает ни в журнал, ни в payload аудита, ни в метрики (ТЗ §16).
"""

from __future__ import annotations

import logging
import math

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import DomainError, ValidationError
from apps.core.models import AuditLog

logger = logging.getLogger(__name__)

# Попыток до блокировки. На устройство — строго, на комнату — свободнее: иначе
# один сосед запирает вход всем живущим в номере.
DEVICE_ATTEMPTS = 5
ROOM_ATTEMPTS = 15

# Первая блокировка. Дальше окно растёт вдвое на каждую следующую, до потолка:
# растущее окно делает перебор бессмысленным, потолок не даёт запереть номер
# навсегда одной вечерней шалостью.
FIRST_BLOCK_S = 15 * 60
MAX_BLOCK_S = 4 * 3600

# Счётчик неудач живёт дольше блокировки: иначе перебор возобновлялся бы
# «с чистого листа» ровно через 15 минут.
FAILURE_WINDOW_S = 24 * 3600

PIN_MIN_LENGTH = 4
PIN_MAX_LENGTH = 12

# Хэш заведомо не подходящего PIN. Нужен, чтобы «PIN не заведён» стоил ровно
# столько же времени, сколько «PIN не тот».
_DUMMY_HASH = make_password("00000000-no-pin")


class PinInvalid(DomainError):
    """
    Код не подошёл. 403, А НЕ 401 — и это не косметика.

    401 для клиента означает одно: «сессия недействительна». Гостевой клиент
    на него чистит токен и уводит на экран ввода номера — так и задумано для
    настоящего истечения. Но отказ step-up не истечение: сессия жива, гость
    тот же, не подошли четыре цифры. С 401 опечатка в PIN выкидывала гостя из
    сессии вместе с корзиной, и он начинал с ввода номера комнаты.

    403 разводит эти два случая по смыслу: «ты кто-то, но сюда нельзя» против
    «ты никто». Обработчик разлогина смотрит на 401 и этот отказ больше не
    трогает.
    """

    status = 403
    code = "PIN_INVALID"


class PinThrottled(DomainError):
    status = 429
    code = "PIN_THROTTLED"


def _bucket_key(kind: str, ident) -> str:
    return f"grms:pin:{kind}:{ident}"


def _read(kind: str, ident) -> dict:
    raw = cache.get(_bucket_key(kind, ident))
    return raw if isinstance(raw, dict) else {"fails": 0, "blocks": 0, "until": 0.0}


def _write(kind: str, ident, bucket: dict) -> None:
    cache.set(_bucket_key(kind, ident), bucket, FAILURE_WINDOW_S)


def _blocked_for(bucket: dict) -> int:
    """Сколько секунд ещё блокировано. 0 — не блокировано."""
    remaining = float(bucket.get("until") or 0.0) - timezone.now().timestamp()
    return int(remaining) if remaining > 0 else 0


def minutes_to_wait(seconds: int) -> int:
    """
    Секунды блокировки → минуты в сообщении гостю, ВВЕРХ.

    Вниз оно отправляло гостя пробовать слишком рано: при остатке 90 секунд
    сообщение говорило «через 1 мин», гость ждал минуту, пробовал и снова
    получал отказ — то есть текст обещал то, чего не выполнял. Вверх — сказали
    «2 мин», через две действительно пустит.

    Прежний `max(1, ...)` был заплаткой ровно на этот случай: он прикрывал
    остаток меньше минуты, который вниз давал ноль («попробуйте через 0 мин»).
    С потолком он не нужен — у любого положительного остатка результат не
    меньше единицы.
    """
    return math.ceil(seconds / 60)


def _register_failure(kind: str, ident, limit: int) -> None:
    bucket = _read(kind, ident)
    bucket["fails"] = int(bucket.get("fails") or 0) + 1
    if bucket["fails"] >= limit:
        blocks = int(bucket.get("blocks") or 0)
        window = min(FIRST_BLOCK_S * (2**blocks), MAX_BLOCK_S)
        bucket["blocks"] = blocks + 1
        bucket["fails"] = 0
        bucket["until"] = timezone.now().timestamp() + window
    _write(kind, ident, bucket)


def _reset(kind: str, ident) -> None:
    cache.delete(_bucket_key(kind, ident))


def attempts_left(session, room_id) -> int:
    device = _read("device", session.pk)
    room = _read("room", room_id)
    return max(
        0,
        min(DEVICE_ATTEMPTS - int(device.get("fails") or 0), ROOM_ATTEMPTS - int(room.get("fails") or 0)),
    )


def verify(hotel, session, *, pin: str) -> dict:
    """
    Проверить PIN и, если сошёлся, отметить УСТРОЙСТВО как подтверждённое.

    Подтверждение живёт на сессии, а не на комнате: «ввёл один раз и работает
    до конца проживания» означает именно это устройство, а не всякого, кто
    потом отсканирует тот же QR.
    """
    from apps.grms.models import RoomPin

    if session is None or session.room_id is None:
        raise PinInvalid("Код не подошёл")

    retry_after = max(
        _blocked_for(_read("device", session.pk)),
        _blocked_for(_read("room", session.room_id)),
    )
    if retry_after:
        _journal(hotel, session, ok=False, note="throttled")
        raise PinThrottled(
            f"Слишком много попыток. Попробуйте через {minutes_to_wait(retry_after)} мин",
            retry_after_s=retry_after,
        )

    with tenant_context(hotel):
        record = RoomPin.objects.filter(room_id=session.room_id).first()

    expected = record.pin_hash if (record and record.is_active) else _DUMMY_HASH
    matched = check_password(str(pin or ""), expected) and record is not None and record.is_active

    if not matched:
        _register_failure("device", session.pk, DEVICE_ATTEMPTS)
        _register_failure("room", session.room_id, ROOM_ATTEMPTS)
        _journal(hotel, session, ok=False, note="mismatch")

        retry_after = max(
            _blocked_for(_read("device", session.pk)),
            _blocked_for(_read("room", session.room_id)),
        )
        if retry_after:
            raise PinThrottled(
                f"Слишком много попыток. Попробуйте через {minutes_to_wait(retry_after)} мин",
                retry_after_s=retry_after,
            )
        raise PinInvalid("Код не подошёл", attempts_left=attempts_left(session, session.room_id))

    _reset("device", session.pk)
    _reset("room", session.room_id)
    session.room_verified_at = timezone.now()
    session.save(update_fields=["room_verified_at", "updated_at"])
    _journal(hotel, session, ok=True, note="verified")
    return {"trust": session.trust, "can_command": True, "room_verified": True}


def _journal(hotel, session, *, ok: bool, note: str) -> None:
    """Каждая попытка — в журнал, успешная и неуспешная. САМ PIN — никогда."""
    with tenant_context(hotel):
        AuditLog.record(
            "grms.pin_attempt",
            actor_type=AuditLog.ActorType.GUEST,
            object_type="grms.session",
            object_id=session.pk,
            payload={
                "room": session.room.number if session.room_id else "",
                "ok": ok,
                "note": note,
            },
            hotel_id=hotel.pk,
        )


# --- Заведение PIN (сторона отеля) -----------------------------------------


def set_pin(hotel, room, *, pin: str, valid_until=None):
    """
    Завести или сменить PIN номера.

    Смена PIN СБРАСЫВАЕТ подтверждение у всех устройств этой комнаты. Это
    ближайшая честная замена «выезду по PMS» из контракта: интеграции нет, но
    момент смены гостя администратор отмечает именно сменой кода, и выехавший
    гость обязан потерять управление номером в этот момент, а не когда-нибудь.
    """
    from apps.accounts.models import GuestSession
    from apps.grms.models import RoomPin

    pin = str(pin or "").strip()
    if not pin.isdigit() or not (PIN_MIN_LENGTH <= len(pin) <= PIN_MAX_LENGTH):
        raise ValidationError(
            f"PIN — от {PIN_MIN_LENGTH} до {PIN_MAX_LENGTH} цифр", field="pin"
        )

    with tenant_context(hotel):
        record, _created = RoomPin.objects.update_or_create(
            room=room,
            defaults={
                "pin_hash": make_password(pin),
                "valid_until": valid_until,
                "issued_at": timezone.now(),
            },
        )
        GuestSession.objects.filter(room=room, room_verified_at__isnull=False).update(
            room_verified_at=None
        )
    _reset("room", room.pk)
    return record


def clear_pin(hotel, room) -> None:
    """Снять PIN номера и подтверждения вместе с ним."""
    from apps.accounts.models import GuestSession
    from apps.grms.models import RoomPin

    with tenant_context(hotel):
        RoomPin.objects.filter(room=room).delete()
        GuestSession.objects.filter(room=room, room_verified_at__isnull=False).update(
            room_verified_at=None
        )
