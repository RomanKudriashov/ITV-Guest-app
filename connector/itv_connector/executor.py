"""
Исполнение задания во внутренней сети объекта.

Это ЕДИНСТВЕННОЕ место коннектора, которое ходит в LAN, и последний рубеж между
облаком и оборудованием отеля. Здесь нет и не должно быть ни строчки про iRidi:
коннектор не знает, что такое `device`, `channel` и `feedback`. Он получает
готовый конверт, сверяет его с ЛОКАЛЬНЫМ конфигом и возвращает сырой ответ.

Ключевое правило контракта: backend называет endpoint ИДЕНТИФИКАТОРОМ, а адрес
знает только объект. Коннектор не доверяет backend в вопросе адресов — иначе
взлом или ошибка в облаке означали бы произвольные запросы во внутреннюю сеть
гостиницы. Поэтому конверт с полем `url` или `baseUrl` здесь отбивается, а не
исполняется.

Чистый stdlib: образ коннектора должен быть маленьким и без лишних зависимостей,
его ставят на чужой сервер и обновляют редко.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

# Коды — те же, что в контракте G0. Дублируются строками намеренно: коннектор
# отдельный сервис и НЕ импортирует backend, иначе он перестал бы быть
# автономным и его нельзя было бы обновлять независимо.
ENDPOINT_UNKNOWN = "ENDPOINT_UNKNOWN"
ENDPOINT_UNREACHABLE = "ENDPOINT_UNREACHABLE"
TIMEOUT = "TIMEOUT"
REQUEST_REJECTED = "REQUEST_REJECTED"


@dataclass
class Endpoint:
    base_url: str
    allowed_methods: tuple[str, ...] = ("GET", "POST")
    allowed_paths: tuple[str, ...] = ("/",)
    timeout_ms: int = 3000
    max_request_bytes: int = 8192
    max_response_bytes: int = 65536
    follow_redirects: bool = False

    @classmethod
    def from_config(cls, raw: dict) -> "Endpoint":
        base = str(raw.get("baseUrl", "")).rstrip("/")
        if not base:
            raise ValueError("endpoint без baseUrl")
        return cls(
            base_url=base,
            allowed_methods=tuple(m.upper() for m in raw.get("allowedMethods", ["GET", "POST"])),
            allowed_paths=tuple(raw.get("allowedPaths", ["/"])),
            timeout_ms=int(raw.get("timeoutMs", 3000)),
            max_request_bytes=int(raw.get("maxRequestBytes", 8192)),
            max_response_bytes=int(raw.get("maxResponseBytes", 65536)),
            follow_redirects=bool(raw.get("followRedirects", False)),
        )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """
    Редирект — способ увести запрос на адрес ВНЕ allowlist. Разрешать его
    значит отдать выбор конечного адреса тому, до кого мы и так не доверяем
    (ТЗ §16). Поэтому по умолчанию редиректы просто не выполняются.
    """

    def redirect_request(self, *args, **kwargs):
        return None


def _reject(request_id: str, code: str, message: str, started: float) -> dict:
    return {
        "type": "connector.response",
        "requestID": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
        "duration_ms": int((time.monotonic() - started) * 1000),
    }


def execute(envelope: dict, endpoints: dict[str, Endpoint]) -> dict:
    """
    Выполнить конверт. Никогда не бросает: любой отказ — это ответ с `ok: false`,
    потому что backend ждёт ответ по requestID, а не исключение.
    """
    started = time.monotonic()
    request_id = str(envelope.get("requestID", ""))

    name = envelope.get("endpoint")
    endpoint = endpoints.get(name)
    if endpoint is None:
        # Приходит, даже если backend уверен в обратном: список endpoint'ов —
        # свойство объекта, а не облака.
        return _reject(request_id, ENDPOINT_UNKNOWN, f"endpoint {name!r} не зарегистрирован", started)

    method = str(envelope.get("method", "POST")).upper()
    if method not in endpoint.allowed_methods:
        return _reject(request_id, REQUEST_REJECTED, f"метод {method} не разрешён", started)

    path = envelope.get("path", "/") or "/"
    if not path.startswith("/"):
        path = "/" + path
    if path not in endpoint.allowed_paths:
        return _reject(request_id, REQUEST_REJECTED, f"путь {path!r} не разрешён", started)

    body = envelope.get("body")
    payload = b"" if body is None else json.dumps(body).encode("utf-8")
    if len(payload) > endpoint.max_request_bytes:
        return _reject(request_id, REQUEST_REJECTED, "запрос больше лимита", started)

    timeout_s = min(int(envelope.get("timeout_ms") or endpoint.timeout_ms), endpoint.timeout_ms) / 1000

    headers = {"Content-Type": "application/json"}
    headers.update(envelope.get("headers") or {})

    # GET С ТЕЛОМ поддержан намеренно, хотя мы им не пользуемся: прозвон
    # показал, что сервер игнорирует метод и читать можно POST'ом. Но на другом
    # объекте может стоять другая сборка скрипта, а коннектор переустанавливать
    # дорого — пусть умеет оба.
    request = urllib.request.Request(
        endpoint.base_url + path, data=payload, headers=headers, method=method
    )
    opener = urllib.request.build_opener(
        *( [] if endpoint.follow_redirects else [_NoRedirect] )
    )

    try:
        with opener.open(request, timeout=timeout_s) as response:
            raw = response.read(endpoint.max_response_bytes + 1)
            truncated = len(raw) > endpoint.max_response_bytes
            raw = raw[: endpoint.max_response_bytes]
            return {
                "type": "connector.response",
                "requestID": request_id,
                "ok": True,
                "status_code": response.status,
                "headers": dict(response.headers.items()),
                # СТРОКОЙ и неразобранным: сервер собирает ответ конкатенацией
                # и умеет отдать невалидный JSON. Разбирать — задача адаптера,
                # а в журнал должно лечь то, что реально пришло.
                "raw_body": raw.decode("utf-8", errors="replace"),
                "truncated": truncated,
                "duration_ms": int((time.monotonic() - started) * 1000),
            }
    except urllib.error.HTTPError as exc:
        # Не отказ транспорта: сервер ответил, пусть и кодом ошибки. Отдаём
        # наверх как обычный ответ — решать адаптеру.
        raw = exc.read(endpoint.max_response_bytes).decode("utf-8", errors="replace")
        return {
            "type": "connector.response",
            "requestID": request_id,
            "ok": True,
            "status_code": exc.code,
            "headers": dict(exc.headers.items()) if exc.headers else {},
            "raw_body": raw,
            "duration_ms": int((time.monotonic() - started) * 1000),
        }
    except TimeoutError:
        return _reject(request_id, TIMEOUT, f"нет ответа за {timeout_s:.1f} с", started)
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason):
            return _reject(request_id, TIMEOUT, str(reason), started)
        return _reject(request_id, ENDPOINT_UNREACHABLE, str(reason), started)
    except OSError as exc:
        return _reject(request_id, ENDPOINT_UNREACHABLE, str(exc), started)
