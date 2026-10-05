"""
TELEGRAM BOT API — реализация `Messenger` (партия 28).

РАЗМЕТКА — HTML С ЭКРАНИРОВАНИЕМ, А НЕ MARKDOWN (п.31 бэклога). Прежний
адаптер слал `parse_mode=Markdown`: звёздочка или подчёркивание в названии
блюда, в комментарии гостя или в имени («Иван_Петров») ломали разбор, и
Telegram отвечал 400 «can't parse entities» — сообщение не уходило вовсе.
Теперь весь текст экранируется (`&`, `<`, `>`), а жирным выделяется только
заголовок, который собираем мы сами.

429 — ЖДАТЬ, СКОЛЬКО СКАЗАНО. Telegram в ответе на 429 говорит `retry_after`
(и заголовок Retry-After): прежний адаптер его игнорировал и повторял по
своему расписанию — раньше срока, получая новый 429. Теперь число уходит в
ошибку, и повтор ставится не раньше, чем разрешили.

ТОКЕН НЕ ПОКИДАЕТ ЭТОТ МОДУЛЬ. Он — часть адреса запроса
(`/bot<токен>/sendMessage`), и сетевое исключение `requests` печатает адрес
целиком. Поэтому любой текст ошибки проходит через `redact`, а наружу
показывается только хвост — последние четыре символа.
"""

from __future__ import annotations

import html
import logging
import re

from django.conf import settings

from .base import Button, Incoming, MessengerError

logger = logging.getLogger("apps.notifications")

# Вид токена Telegram: число, двоеточие, секрет.
_TOKEN = re.compile(r"\d{5,}:[A-Za-z0-9_-]{20,}")


class RedactTokens(logging.Filter):
    """
    `urllib3` на уровне DEBUG пишет адрес запроса целиком — а в адресе бота
    токен (`/bot<токен>/sendMessage`). Нашёл сторож партии 28 в первом же
    прогоне. Фильтр заменяет токен хвостом прямо в записи журнала, до любого
    обработчика.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if _TOKEN.search(message):
            record.msg = _TOKEN.sub(lambda match: token_tail(match.group(0)), message)
            record.args = ()
        return True


logging.getLogger("urllib3.connectionpool").addFilter(RedactTokens())

# Лимит Telegram на текст сообщения — 4096 символов ПОСЛЕ разбора разметки.
# Режем с запасом на теги заголовка и строку статуса, которую допишет действие.
TEXT_LIMIT = 3800


def token_tail(token: str) -> str:
    token = (token or "").strip()
    return f"…{token[-4:]}" if token else ""


def compose(subject: str, body: str) -> str:
    """Заголовок жирным, остальное — как есть; всё экранировано."""
    subject = (subject or "").strip()
    body = (body or "").strip()
    if len(body) > TEXT_LIMIT:
        body = body[: TEXT_LIMIT - 1] + "…"
    parts = []
    if subject:
        parts.append(f"<b>{html.escape(subject, quote=False)}</b>")
    if body:
        parts.append(html.escape(body, quote=False))
    return "\n".join(parts) or "—"


def keyboard(buttons: list[Button]) -> dict:
    """По кнопке в ряд: подписи длинные («Открыть в трекере»), в ряд по две не влезают."""
    rows = []
    for button in buttons:
        if button.url:
            rows.append([{"text": button.label, "url": button.url}])
        elif button.action:
            rows.append([{"text": button.label, "callback_data": button.action[:64]}])
    return {"inline_keyboard": rows}


class TelegramBot:
    code = "telegram"

    def __init__(self, token: str | None = None, api_url: str | None = None):
        self._token = (settings.TELEGRAM_BOT_TOKEN if token is None else token or "").strip()
        self._api = (api_url or settings.TELEGRAM_API_URL).rstrip("/")

    # --- Секрет ---------------------------------------------------------------

    def configured(self) -> bool:
        return bool(self._token)

    def token_tail(self) -> str:
        return token_tail(self._token)

    def redact(self, text: str) -> str:
        text = str(text or "")
        if self._token:
            text = text.replace(self._token, self.token_tail())
        return text

    # --- Запрос ---------------------------------------------------------------

    def _call(self, method: str, payload: dict, *, timeout: float = 10):
        import requests

        if not self._token:
            raise MessengerError("Бот не подключён: токен не задан", retryable=False, unauthorized=True)
        url = f"{self._api}/bot{self._token}/{method}"
        try:
            response = requests.post(url, json=payload, timeout=timeout)
        except requests.RequestException as exc:
            # str(exc) содержит адрес — а в адресе токен.
            raise MessengerError(f"Telegram недоступен: {self.redact(exc)}") from None

        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code == 200 and data.get("ok"):
            return data.get("result")
        raise self._error(response, data)

    def _error(self, response, data: dict) -> MessengerError:
        status = response.status_code
        description = self.redact(data.get("description") or response.text[:200])
        detail = f"Telegram ответил {status}: {description}"
        if status in (401, 404):
            # Неверный токен Telegram отдаёт 401, а несуществующего бота — 404.
            return MessengerError(f"Токен не принят ({self.token_tail()})", retryable=False, unauthorized=True)
        if status == 409:
            return MessengerError(
                "Бота уже опрашивает другой сервер (409): один токен — один опрашивающий",
                retryable=False,
                conflict=True,
            )
        if status == 429:
            retry_after = (data.get("parameters") or {}).get("retry_after")
            if retry_after is None:
                header = response.headers.get("Retry-After") if response.headers else None
                retry_after = int(header) if header and str(header).isdigit() else None
            return MessengerError(detail, retryable=True, retry_after=int(retry_after or 1))
        lowered = description.lower()
        if status == 403 or "chat not found" in lowered or "user is deactivated" in lowered:
            return MessengerError("Бот заблокирован получателем", retryable=False, blocked=True)
        return MessengerError(detail, retryable=status >= 500)

    # --- Messenger --------------------------------------------------------------

    def me(self) -> str:
        result = self._call("getMe", {})
        return str((result or {}).get("username") or "")

    def updates(self, offset: int, timeout: int) -> list[Incoming]:
        result = self._call(
            "getUpdates",
            {"offset": offset, "timeout": timeout, "allowed_updates": ["message", "callback_query", "my_chat_member"]},
            timeout=timeout + 10,
        )
        return [item for item in (self._incoming(raw) for raw in result or []) if item is not None]

    def send(self, chat_id: str, subject: str, body: str, buttons: list[Button]) -> str:
        payload = {
            "chat_id": chat_id,
            "text": compose(subject, body),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if buttons:
            payload["reply_markup"] = keyboard(buttons)
        result = self._call("sendMessage", payload)
        return str((result or {}).get("message_id", ""))

    def edit(self, chat_id: str, message_id: str, subject: str, body: str, buttons: list[Button]) -> None:
        payload = {
            "chat_id": chat_id,
            "message_id": int(message_id),
            "text": compose(subject, body),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
            "reply_markup": keyboard(buttons),
        }
        try:
            self._call("editMessageText", payload)
        except MessengerError as exc:
            # Тот же текст повторно — не ошибка: два быстрых нажатия.
            if "not modified" not in exc.detail:
                raise

    def leave(self, chat_id: str) -> None:
        self._call("leaveChat", {"chat_id": chat_id})

    def answer(self, callback_id: str, text: str, *, alert: bool = False) -> None:
        self._call(
            "answerCallbackQuery",
            {"callback_query_id": callback_id, "text": text[:190], "show_alert": alert},
        )

    # --- Разбор входящего -------------------------------------------------------

    @staticmethod
    def _incoming(raw: dict) -> Incoming | None:
        update_id = int(raw.get("update_id") or 0)
        if "callback_query" in raw:
            query = raw["callback_query"] or {}
            sender = query.get("from") or {}
            message = query.get("message") or {}
            chat = message.get("chat") or {}
            return Incoming(
                kind="callback",
                update_id=update_id,
                chat_id=str(chat.get("id") or sender.get("id") or ""),
                sender_id=str(sender.get("id") or ""),
                chat_type=str(chat.get("type") or "private"),
                username=str(sender.get("username") or ""),
                language=str(sender.get("language_code") or ""),
                callback_id=str(query.get("id") or ""),
                data=str(query.get("data") or ""),
                message_id=str(message.get("message_id") or ""),
                message_text=str(message.get("text") or ""),
            )
        member = raw.get("my_chat_member")
        if member:
            # Бота добавили в группу или удалили из неё (партия 32): `text` —
            # новое состояние бота в чате (member / administrator / left / kicked).
            chat = member.get("chat") or {}
            sender = member.get("from") or {}
            return Incoming(
                kind="membership",
                update_id=update_id,
                chat_id=str(chat.get("id") or ""),
                sender_id=str(sender.get("id") or ""),
                chat_type=str(chat.get("type") or "private"),
                text=str((member.get("new_chat_member") or {}).get("status") or ""),
            )
        message = raw.get("message")
        if message and message.get("migrate_to_chat_id"):
            # Группа стала супергруппой — у неё новый адрес.
            return Incoming(
                kind="migrate",
                update_id=update_id,
                chat_id=str((message.get("chat") or {}).get("id") or ""),
                sender_id="",
                data=str(message.get("migrate_to_chat_id")),
            )
        if message:
            sender = message.get("from") or {}
            chat = message.get("chat") or {}
            return Incoming(
                kind="message",
                update_id=update_id,
                chat_id=str(chat.get("id") or ""),
                sender_id=str(sender.get("id") or ""),
                chat_type=str(chat.get("type") or "private"),
                username=str(sender.get("username") or ""),
                language=str(sender.get("language_code") or ""),
                text=str(message.get("text") or ""),
                message_id=str(message.get("message_id") or ""),
                # Название чата — для групп: бот называет группу в ответе, панель
                # показывает, к какой группе подключён канал.
                chat_title=str(chat.get("title") or ""),
            )
        # Прочие виды обновлений мы не заказывали; пришедшее — пропускаем,
        # но `update_id` всё равно сдвигает очередь.
        return Incoming(kind="other", update_id=update_id, chat_id="", sender_id="")
