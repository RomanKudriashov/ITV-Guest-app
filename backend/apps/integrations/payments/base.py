"""
Шов оплаты. Как и PMS — только интерфейс и адаптер «нет».

Суммы везде в минимальных единицах (копейках) и целыми: платёжные системы
работают именно так, и это же снимает вопрос округления при расчёте заказа.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(slots=True)
class PaymentIntent:
    reference: str
    status: str
    redirect_url: str = ""


class PaymentAdapter(Protocol):
    name: str

    def is_available(self) -> bool: ...

    def create_intent(
        self, *, amount_minor: int, currency: str, order_reference: str
    ) -> PaymentIntent: ...

    def refund(self, *, reference: str, amount_minor: int) -> PaymentIntent: ...


class PaymentUnavailable(Exception):
    pass


class NullPaymentAdapter:
    """Оплаты нет: заказ оформляется, расчёт — на месте или на счёт номера."""

    name = "null"

    def is_available(self) -> bool:
        return False

    def create_intent(
        self, *, amount_minor: int, currency: str, order_reference: str
    ) -> PaymentIntent:
        raise PaymentUnavailable("Онлайн-оплата не подключена")

    def refund(self, *, reference: str, amount_minor: int) -> PaymentIntent:
        raise PaymentUnavailable("Онлайн-оплата не подключена")
