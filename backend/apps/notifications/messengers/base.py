"""
МЕССЕНДЖЕР-БОТ — ЗА ОДНИМ ИНТЕРФЕЙСОМ (партия 28).

Бот платформы один: он принимает коды привязки, присылает сотруднику личные
уведомления и принимает нажатия кнопок под ними. Сейчас за интерфейсом стоит
только Telegram; второй мессенджер (Max) — это вторая реализация `Messenger`
и строка в реестре `apps/notifications/messengers/__init__.py`, а служба
опроса, привязка и действия по кнопкам не меняются.

Интерфейс говорит на языке приложения, а не провайдера: входящее — это
`Incoming` (сообщение или нажатие), исходящее — заголовок, текст и кнопки.
Разметка, лимиты длины, коды ошибок и их смысл — забота реализации.
"""

from __future__ import annotations

import dataclasses
from typing import Protocol


@dataclasses.dataclass(slots=True, frozen=True)
class Button:
    """Кнопка под сообщением: либо действие (`action` — данные нажатия), либо ссылка."""

    label: str
    action: str = ""
    url: str = ""


@dataclasses.dataclass(slots=True)
class Incoming:
    """Входящее от человека: сообщение боту или нажатие кнопки."""

    kind: str  # "message" | "callback"
    update_id: int
    # Куда отвечать (личный чат) и кто это сделал. В личном чате совпадают;
    # привязка и права всегда идут по `sender_id` — по человеку, а не по чату.
    chat_id: str
    sender_id: str
    chat_type: str = "private"
    username: str = ""
    language: str = ""
    text: str = ""
    # Нажатие: его идентификатор (ответить на него), данные кнопки и
    # сообщение, под которым она была.
    callback_id: str = ""
    data: str = ""
    message_id: str = ""
    message_text: str = ""


class MessengerError(Exception):
    """
    Мессенджер не принял запрос. Текст ошибки НИКОГДА не содержит токена —
    реализация обязана вычищать его сама (адрес запроса у Telegram содержит
    токен, и сетевое исключение `requests` печатает адрес целиком).

      * `unauthorized` — токен не принят: повторять бессмысленно;
      * `conflict` — бота опрашивает кто-то ещё (409): один токен — один
        опрашивающий;
      * `blocked` — человек заблокировал бота или удалил чат;
      * `retry_after` — мессенджер попросил подождать столько секунд.
    """

    def __init__(
        self,
        detail: str,
        *,
        retryable: bool = True,
        retry_after: int | None = None,
        blocked: bool = False,
        unauthorized: bool = False,
        conflict: bool = False,
    ):
        super().__init__(detail)
        self.detail = detail
        self.retryable = retryable
        self.retry_after = retry_after
        self.blocked = blocked
        self.unauthorized = unauthorized
        self.conflict = conflict


class Messenger(Protocol):
    code: str

    def configured(self) -> bool:
        """Задан ли токен. Без токена служба спит, а панель говорит «бот не подключён»."""

    def token_tail(self) -> str:
        """Последние четыре символа токена — всё, что о нём можно показать."""

    def me(self) -> str:
        """Имя бота у мессенджера. Не зашивается в настройки — спрашивается."""

    def updates(self, offset: int, timeout: int) -> list[Incoming]:
        """Входящие начиная с `offset` (длинный опрос)."""

    def send(self, chat_id: str, subject: str, body: str, buttons: list[Button]) -> str:
        """Отправить; вернуть идентификатор сообщения."""

    def edit(self, chat_id: str, message_id: str, subject: str, body: str, buttons: list[Button]) -> None:
        """Переписать отправленное: после действия под ним другая строка и другие кнопки."""

    def answer(self, callback_id: str, text: str, *, alert: bool = False) -> None:
        """Ответ на нажатие — всплывающая строка у того, кто нажал."""
