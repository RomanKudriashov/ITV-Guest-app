"""
Каналы доставки — за одним интерфейсом.

Новый канал (WhatsApp, SMS, пуш) = новый адаптер и строка в реестре; движок
эскалации не меняется. Ровно та же дисциплина, что у типов предложений и у
адаптеров PMS/оплаты.
"""

from __future__ import annotations

import dataclasses
from typing import Protocol


@dataclasses.dataclass(slots=True)
class RenderedMessage:
    """Готовое к отправке сообщение. Рендер шаблона — забота движка, не канала."""

    subject: str
    body: str
    # Кнопки под сообщением (партия 28): «Взять в работу», «Открыть в трекере»,
    # «Разобрать». Канал, который кнопок не умеет (почта, лог), их не рисует.
    buttons: tuple = ()


class ChannelError(Exception):
    """
    Канал не принял сообщение.

    `retryable=False` — повторять бессмысленно (неверный токен, нет получателя):
    ретраи только зря дёргали бы внешнюю систему и оттягивали момент, когда в
    журнале появится честное «failed».
    """

    def __init__(
        self,
        detail: str,
        *,
        retryable: bool = True,
        retry_after: int | None = None,
        blocked: bool = False,
    ):
        super().__init__(detail)
        self.detail = detail
        self.retryable = retryable
        # Канал сам сказал, сколько ждать (429 Retry-After): повтор — не раньше.
        self.retry_after = retry_after
        # Получатель заблокировал бота: повторять бессмысленно, а карточке
        # сотрудника есть что показать.
        self.blocked = blocked


class ChannelAdapter(Protocol):
    type: str
    # Поля конфигурации, которые нельзя отдавать наружу.
    secret_fields: tuple[str, ...]

    def validate_config(self, config: dict) -> None:
        """Бросает ValidationError, если конфигурации не хватает."""

    def send(self, message: RenderedMessage, config: dict) -> str:
        """Отправляет и возвращает ссылку провайдера. Бросает ChannelError."""
