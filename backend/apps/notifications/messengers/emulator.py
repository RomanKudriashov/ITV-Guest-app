"""
ЭМУЛЯТОР TELEGRAM BOT API — ДЛЯ ТЕСТОВ И РАЗРАБОТКИ (партия 28).

Настоящий Telegram тестами не трогается: у бота один токен, и второй
опрашивающий (тест, машина разработчика) выбил бы стенд ответом 409. Эмулятор
отвечает тем же HTTP, что Bot API, — `getMe`, `getUpdates`, `sendMessage`,
`editMessageText`, `answerCallbackQuery` — и код приложения ходит сюда
настоящим `requests`: меняется только адрес (`TELEGRAM_API_URL`).

Управление — под `/_emulator/`:

  * `POST /_emulator/message`  {"chat_id", "text", "username"?, "language"?} —
    человек пишет боту;
  * `POST /_emulator/press`    {"chat_id", "message_id", "data"} — человек
    нажимает кнопку под сообщением, которое бот ему прислал;
  * `GET  /_emulator/calls`    ?method=&chat_id= — что бот отправлял;
  * `GET  /_emulator/messages` ?chat_id= — сообщения бота в их нынешнем виде
    (после правок), с кнопками;
  * `POST /_emulator/scenario` {"blocked": [chat_id], "rate_limit":
    {"method", "times", "retry_after"}, "conflict": bool} — отказы;
  * `POST /_emulator/reset`.

Токен, в котором есть слово `invalid`, эмулятор не принимает (401) — так
проверяется «токен не принят» без настоящего Telegram.

Чистый stdlib, Django не импортируется. Запуск:
python -m apps.notifications.messengers.emulator (порт TELEGRAM_EMULATOR_PORT, 1087)
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BOT_USERNAME = os.getenv("TELEGRAM_EMULATOR_BOT", "itv_emulator_bot")
_PATH = re.compile(r"^/bot(?P<token>[^/]+)/(?P<method>\w+)$")


class State:
    def __init__(self) -> None:
        self.lock = threading.Condition()
        self.reset()

    def reset(self) -> None:
        self.updates: list[dict] = []
        self.next_update = 1
        self.calls: list[dict] = []
        self.messages: dict[int, dict] = {}
        self.next_message = 1
        self.blocked: set[str] = set()
        self.rate_limit: dict | None = None
        self.conflict = False

    def push(self, update: dict) -> int:
        with self.lock:
            update["update_id"] = self.next_update
            self.next_update += 1
            self.updates.append(update)
            self.lock.notify_all()
            return update["update_id"]


STATE = State()


def _user(chat_id, username="", language="ru") -> dict:
    return {"id": int(chat_id), "is_bot": False, "first_name": username or "Тест", "username": username, "language_code": language}


class Handler(BaseHTTPRequestHandler):
    server_version = "TelegramEmulator/1.0"

    def log_message(self, *args) -> None:  # тишина в логах тестов
        return

    # --- Ответы ----------------------------------------------------------------

    def _json(self, status: int, payload: dict, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, result) -> None:
        self._json(200, {"ok": True, "result": result})

    def _fail(self, status: int, description: str, **extra) -> None:
        self._json(status, {"ok": False, "error_code": status, "description": description, **extra.pop("body", {})}, extra.get("headers"))

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    # --- Маршрутизация ------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        if url.path == "/_emulator/calls":
            with STATE.lock:
                calls = [
                    call
                    for call in STATE.calls
                    if (not query.get("method") or call["method"] == query["method"])
                    and (not query.get("chat_id") or str(call["payload"].get("chat_id")) == query["chat_id"])
                ]
            return self._json(200, {"calls": calls})
        if url.path == "/_emulator/messages":
            with STATE.lock:
                messages = [
                    message
                    for message in STATE.messages.values()
                    if not query.get("chat_id") or str(message["chat_id"]) == query["chat_id"]
                ]
            return self._json(200, {"messages": messages})
        if url.path == "/_emulator/health":
            return self._json(200, {"ok": True})
        return self._fail(404, "Not Found")

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        payload = self._body()
        if url.path.startswith("/_emulator/"):
            return self._control(url.path.removeprefix("/_emulator/"), payload)
        match = _PATH.match(url.path)
        if not match:
            return self._fail(404, "Not Found")
        token, method = match.group("token"), match.group("method")
        if "invalid" in token:
            return self._fail(401, "Unauthorized")
        return self._method(method, payload)

    # --- Управление -------------------------------------------------------------

    def _control(self, action: str, payload: dict) -> None:
        if action == "reset":
            with STATE.lock:
                STATE.reset()
            return self._json(200, {"ok": True})
        if action == "scenario":
            with STATE.lock:
                if "blocked" in payload:
                    STATE.blocked = {str(chat) for chat in payload["blocked"] or []}
                if "rate_limit" in payload:
                    STATE.rate_limit = payload["rate_limit"]
                if "conflict" in payload:
                    STATE.conflict = bool(payload["conflict"])
            return self._json(200, {"ok": True})
        if action == "message":
            chat_id = int(payload["chat_id"])
            update_id = STATE.push(
                {
                    "message": {
                        "message_id": int(time.time() * 1000) % 1_000_000_000,
                        "from": _user(chat_id, payload.get("username", ""), payload.get("language", "ru")),
                        "chat": {
                            "id": chat_id,
                            "type": payload.get("chat_type", "private"),
                            # Групповой чат (партия 32) — с названием, как у Telegram.
                            **({"title": payload["chat_title"]} if payload.get("chat_title") else {}),
                        },
                        "date": int(time.time()),
                        "text": payload.get("text", ""),
                    }
                }
            )
            return self._json(200, {"ok": True, "update_id": update_id})
        if action == "member":
            # Бота добавили в группу или удалили из неё: status member / left / kicked.
            chat_id = int(payload["chat_id"])
            update_id = STATE.push(
                {
                    "my_chat_member": {
                        "chat": {"id": chat_id, "type": payload.get("chat_type", "group"), "title": payload.get("chat_title", "")},
                        "from": _user(int(payload.get("from_id") or 1), "", "ru"),
                        "date": int(time.time()),
                        "new_chat_member": {"status": payload.get("status", "left"), "user": {"id": 1, "is_bot": True}},
                    }
                }
            )
            return self._json(200, {"ok": True, "update_id": update_id})
        if action == "migrate":
            # Группа стала супергруппой: старому чату приходит migrate_to_chat_id.
            update_id = STATE.push(
                {
                    "message": {
                        "message_id": int(time.time() * 1000) % 1_000_000_000,
                        "chat": {"id": int(payload["chat_id"]), "type": "group"},
                        "date": int(time.time()),
                        "migrate_to_chat_id": int(payload["to_chat_id"]),
                    }
                }
            )
            return self._json(200, {"ok": True, "update_id": update_id})
        if action == "press":
            chat_id = int(payload["chat_id"])
            with STATE.lock:
                message = STATE.messages.get(int(payload.get("message_id") or 0)) or {}
            update_id = STATE.push(
                {
                    "callback_query": {
                        "id": f"cb{int(time.time() * 1000)}",
                        "from": _user(chat_id, payload.get("username", ""), payload.get("language", "ru")),
                        "message": {
                            "message_id": int(payload.get("message_id") or 0),
                            "chat": {"id": chat_id, "type": "private"},
                            "text": message.get("plain", ""),
                        },
                        "data": payload.get("data", ""),
                    }
                }
            )
            return self._json(200, {"ok": True, "update_id": update_id})
        return self._fail(404, "Not Found")

    # --- Bot API ---------------------------------------------------------------

    def _method(self, method: str, payload: dict) -> None:
        with STATE.lock:
            STATE.calls.append({"method": method, "payload": payload, "at": time.time()})
            limit = STATE.rate_limit
            if limit and limit.get("method") == method and int(limit.get("times") or 0) > 0:
                limit["times"] = int(limit["times"]) - 1
                retry_after = int(limit.get("retry_after") or 1)
                return self._fail(
                    429,
                    f"Too Many Requests: retry after {retry_after}",
                    body={"parameters": {"retry_after": retry_after}},
                    headers={"Retry-After": str(retry_after)},
                )
            chat = str(payload.get("chat_id", ""))
            if chat and chat in STATE.blocked and method in ("sendMessage", "editMessageText"):
                return self._fail(403, "Forbidden: bot was blocked by the user")

        if method == "getMe":
            return self._ok({"id": 1, "is_bot": True, "first_name": "ITV", "username": BOT_USERNAME})
        if method == "deleteWebhook":
            return self._ok(True)
        if method == "getUpdates":
            if STATE.conflict:
                return self._fail(409, "Conflict: terminated by other getUpdates request")
            return self._ok(self._updates(payload))
        if method == "sendMessage":
            with STATE.lock:
                message_id = STATE.next_message
                STATE.next_message += 1
                STATE.messages[message_id] = _stored(message_id, payload)
            return self._ok({"message_id": message_id, "chat": {"id": payload.get("chat_id")}, "text": payload.get("text")})
        if method == "editMessageText":
            message_id = int(payload.get("message_id") or 0)
            with STATE.lock:
                if message_id not in STATE.messages:
                    return self._fail(400, "Bad Request: message to edit not found")
                previous = STATE.messages[message_id]
                stored = _stored(message_id, payload)
                if stored["text"] == previous["text"] and stored["buttons"] == previous["buttons"]:
                    return self._fail(400, "Bad Request: message is not modified")
                stored["edits"] = previous.get("edits", 0) + 1
                STATE.messages[message_id] = stored
            return self._ok(True)
        if method == "answerCallbackQuery":
            return self._ok(True)
        if method == "leaveChat":
            with STATE.lock:
                STATE.blocked.add(str(payload.get("chat_id", "")))
            return self._ok(True)
        return self._fail(404, "Not Found: method not found")

    def _updates(self, payload: dict) -> list[dict]:
        offset = int(payload.get("offset") or 0)
        timeout = min(float(payload.get("timeout") or 0), 30.0)
        deadline = time.time() + timeout
        with STATE.lock:
            # Подтверждённое (`offset`) Telegram забывает — и мы тоже.
            STATE.updates = [update for update in STATE.updates if update["update_id"] >= offset]
            while not STATE.updates and time.time() < deadline:
                STATE.lock.wait(timeout=max(0.0, deadline - time.time()))
            return list(STATE.updates)


def _stored(message_id: int, payload: dict) -> dict:
    text = str(payload.get("text") or "")
    rows = ((payload.get("reply_markup") or {}).get("inline_keyboard")) or []
    return {
        "message_id": message_id,
        "chat_id": str(payload.get("chat_id")),
        "text": text,
        # Как его видит человек: без тегов и сущностей — так Telegram и отдаёт
        # текст сообщения в нажатии.
        "plain": re.sub(r"<[^>]+>", "", text).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"),
        "parse_mode": payload.get("parse_mode"),
        "buttons": [button for row in rows for button in row],
    }


def serve(port: int = 0) -> ThreadingHTTPServer:
    """Поднять в потоке (для pytest). Порт 0 — любой свободный."""
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> None:
    port = int(os.getenv("TELEGRAM_EMULATOR_PORT", "1087"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    print(f"Эмулятор Telegram Bot API на :{port}, бот @{BOT_USERNAME}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
