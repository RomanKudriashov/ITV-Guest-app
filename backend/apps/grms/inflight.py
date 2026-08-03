"""
Команды в полёте: состояние `pending` между HTTP-ответом и подтверждением.

Зачем отдельный реестр. Гостевой POST обязан вернуться немедленно, а цикл
перечтения feedback длится до ~4 секунд и живёт в воркере. Между этими двумя
моментами элемент находится в состоянии, которого в БД нет и быть не должно:
это не факт о номере, а факт о нашем собственном незавершённом действии.

Три вещи, ради которых он существует:

  1. `pending` в снапшоте. Гость видит «в процессе», а не мигание старого
     значения, и элемент заблокирован.
  2. Дедуп повторного тапа. `cache.add` атомарен в Redis: вторая команда на тот
     же элемент, пока первая в полёте, не создаёт вторую задачу — иначе гость
     «дробью» набьёт очередь в оборудование.
  3. Автоматическое протухание. TTL чуть больше окна подтверждения: если воркер
     умер вместе с задачей, запись исчезнет сама и элемент вернётся к
     ФАКТИЧЕСКОМУ прочитанному состоянию, а не застрянет в «в процессе»
     навсегда.

Ключ — по (отель, комната, элемент), а НЕ по сессии: в номере два телефона, и
команда, отправленная с одного, обязана быть видна второму как «в процессе».
Именно это делает дедуп настоящим, а не «дедупом в пределах одной вкладки».
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from django.core.cache import cache

# Окно подтверждения (~3.7 с) плюс запас на очередь Celery и саму отправку.
# Больше — элемент подвисает в «в процессе» после падения воркера; меньше —
# дедуп отпускает раньше, чем команда реально закончилась.
INFLIGHT_TTL_S = 20


@dataclass(frozen=True)
class Inflight:
    command_id: str
    capability: str
    value: object
    started_at: float

    @property
    def age_s(self) -> float:
        return max(0.0, time.time() - self.started_at)


def _key(hotel_id, room_id, control_id: str) -> str:
    return f"grms:inflight:{hotel_id}:{room_id}:{control_id}"


def begin(hotel_id, room_id, control_id: str, *, capability: str, value) -> Inflight | None:
    """
    Занять элемент под команду. None — элемент уже занят другой командой.

    Атомарность здесь не формальность: два одновременных тапа с двух телефонов
    в одном номере — обычное дело, и `get` + `set` вместо `add` пропустил бы
    обе команды в оборудование.
    """
    entry = Inflight(
        command_id=str(uuid.uuid4()),
        capability=capability,
        value=value,
        started_at=time.time(),
    )
    stored = cache.add(
        _key(hotel_id, room_id, control_id),
        {
            "command_id": entry.command_id,
            "capability": entry.capability,
            "value": entry.value,
            "started_at": entry.started_at,
        },
        INFLIGHT_TTL_S,
    )
    return entry if stored else None


def get(hotel_id, room_id, control_id: str) -> Inflight | None:
    raw = cache.get(_key(hotel_id, room_id, control_id))
    if not isinstance(raw, dict):
        return None
    return Inflight(
        command_id=str(raw.get("command_id") or ""),
        capability=str(raw.get("capability") or ""),
        value=raw.get("value"),
        started_at=float(raw.get("started_at") or 0.0),
    )


def active_controls(hotel_id, room_id, control_ids) -> dict[str, Inflight]:
    """Какие из элементов номера сейчас заняты. Один поход в кэш на элемент."""
    found: dict[str, Inflight] = {}
    for control_id in control_ids:
        entry = get(hotel_id, room_id, control_id)
        if entry is not None:
            found[control_id] = entry
    return found


def finish(hotel_id, room_id, control_id: str) -> None:
    """Команда завершилась любым исходом — элемент освобождён."""
    cache.delete(_key(hotel_id, room_id, control_id))
