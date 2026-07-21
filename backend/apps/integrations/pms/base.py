"""
Шов PMS. Реализацию в этом прогоне не пишем — фиксируем интерфейс и адаптер
«нет», чтобы прикладной код уже сейчас писался против него, а не против
конкретной системы.

Что от PMS понадобится дальше: подтверждение проживания (для доверия и для
записи на счёт номера), язык гостя, имя гостя, синхронизация номеров.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class Stay:
    guest_ref: str
    room_number: str
    guest_name: str = ""
    language: str = ""
    check_in: datetime | None = None
    check_out: datetime | None = None


class PMSAdapter(Protocol):
    name: str

    def is_available(self) -> bool:
        """Есть ли вообще интеграция у этого отеля."""

    def find_active_stay(self, room_number: str) -> Stay | None:
        """Кто сейчас живёт в номере. None — никого/неизвестно."""

    def post_charge(
        self, *, room_number: str, amount_minor: int, currency: str, reference: str
    ) -> str:
        """Записать сумму на счёт номера. Возвращает ссылку на проводку."""


class PMSUnavailable(Exception):
    pass


class NullPMSAdapter:
    """
    Адаптер «PMS нет».

    Не притворяется, что данные есть: любой запрос состояния возвращает None,
    любая попытка провести оплату — явная ошибка. Продукт обязан работать без
    PMS, просто с меньшим доверием к гостю.
    """

    name = "null"

    def is_available(self) -> bool:
        return False

    def find_active_stay(self, room_number: str) -> Stay | None:
        return None

    def post_charge(
        self, *, room_number: str, amount_minor: int, currency: str, reference: str
    ) -> str:
        raise PMSUnavailable("PMS не подключена: запись на счёт номера недоступна")
