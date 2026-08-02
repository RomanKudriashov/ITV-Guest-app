"""
Эмулятор HTTP-сервера iRidi — с ЖИВОЙ обратной связью.

Зачем он вообще нужен, хотя есть боевой стенд: боевой стенд feedback НЕ отдаёт.
Прозвон G0 (docs/grms/iridi-probe.md §7) показал 120 из 120 чтений со значением
`false`, и после успешного SET значение не менялось никогда. На таком сервере
гостевой цикл «отправили → перечитали → подтвердили» физически не собрать: он
всегда упирался бы в «команда не подтверждена». Поэтому цикл собирается здесь.

Эмулятор намеренно повторяет КВИРКИ, а не «правильный REST». Список — из
прозвона, каждый пункт проверен на живом сервере:

    * всегда HTTP 200, неуспех живёт в ТЕЛЕ;
    * две РАЗНЫЕ формы ответа: «плохой запрос» собран через JSON (status —
      булев, requestID — null), остальные — конкатенацией строк (status и
      value — СТРОКИ);
    * HTTP-метод и путь игнорируются, смотрим только на body["request"];
    * "request" регистрозависим: "get" — плохой запрос;
    * subdevice склеивается как subdevice + ":" + tag, поэтому непустой
      subdevice ломает чтение (ищется несуществующий «Custom:F_DND»);
    * неизвестный тег даёт value "undefined" (строкой), неизвестное
      устройство — status "false";
    * requestID возвращается эхом БЕЗ экранирования.

Последний пункт — настоящая дыра (JSON-инъекция), и воспроизводится он
осознанно: именно на нём проверяется UUIDv4-guard адаптера. Эмулятор
запускается только локально, наружу не смотрит.

ЗАДЕРЖКА FEEDBACK — главное, ради чего это написано. На реальном объекте между
«iRidi принял SET» и «регистр обратной связи обновился» проходит время: команда
уходит в GRMS, тот доезжает до оборудования, и только следующий цикл опроса
Modbus приносит новое значение. Поэтому SET здесь НЕ меняет feedback мгновенно:
он ставит отложенное изменение. Немедленное перечитывание вернёт СТАРОЕ
значение — ровно как в жизни. Без этого «подтверждение» на эмуляторе проходило
бы с первой попытки и не проверяло бы ничего.

Чистый stdlib и ни одного импорта Django: этот модуль должен одинаково
запускаться и как отдельный сервис в Docker, и внутри теста в потоке.
"""

from __future__ import annotations

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Сколько ждать, прежде чем feedback догонит команду. Разброс — не украшение:
# фиксированная задержка позволила бы тесту угадать момент и «подтвердиться»
# ровно одной попыткой, а цикл перечитывания обязан переживать разброс.
DEFAULT_LATENCY_RANGE = (1.0, 3.0)

DEVICE_TEMPLATE = "Modbus TCP Server (Slave mode) {room}"


def _channels_for(lights: int, curtains: int, fcus: int, scenes: int) -> dict[str, int]:
    """
    Набор каналов номера. Имена — РОВНО те, что найдены на боевом сервере
    (iridi-probe.md §6.3), включая пробел перед номером: «C_Light 1», а не
    «C_Light_1». Расхождение здесь означало бы, что эмулятор проверяет
    несуществующий протокол.
    """
    state: dict[str, int] = {"DND": 0, "MUR": 0}
    for i in range(1, lights + 1):
        state[f"Light {i}"] = 0
    for i in range(1, curtains + 1):
        state[f"Curtain {i}"] = 0
    for i in range(1, fcus + 1):
        state[f"FCU_MainSw {i}"] = 0
        state[f"FCU_Speed {i}"] = 0
        state[f"FCU_Setpoint {i}"] = 22
        # Температура — только чтение: команды C_FCU_Temperature нет, но
        # feedback обязан существовать и отдавать число.
        state[f"FCU_Temperature {i}"] = 23
    for i in range(1, scenes + 1):
        # У сцены есть команда и НЕТ feedback — так на боевом сервере
        # (F_Scene_* не существует). Держим её отдельным множеством ниже.
        state[f"Scene_{i}"] = 0
    return state


# Три типа с боевого стенда. ТИП1 — с реальными 12 группами света, а не 10 из
# Excel: расхождение зафиксировано в iridi-probe.md §8.2, и эмулятор повторяет
# СЕРВЕР, потому что именно он источник правды о железе.
ROOM_PROFILES: dict[str, dict[str, int]] = {
    "701": {"lights": 12, "curtains": 1, "fcus": 1, "scenes": 2},
    "708": {"lights": 11, "curtains": 3, "fcus": 2, "scenes": 2},
    "706": {"lights": 12, "curtains": 2, "fcus": 2, "scenes": 2},
}
DEFAULT_ROOMS = ["201", "202", "203", "301", "401", "415", "501", "601", "701", "706", "708"]


class IridiEmulator:
    """
    Состояние всех устройств. Потокобезопасно: HTTP-сервер многопоточный, а
    отложенные изменения читаются и применяются из разных запросов.
    """

    def __init__(self, *, latency_range: tuple[float, float] = DEFAULT_LATENCY_RANGE):
        self.latency_range = latency_range
        self._lock = threading.Lock()
        # device -> tag -> значение, видимое feedback'ом ПРЯМО СЕЙЧАС
        self._current: dict[str, dict[str, int]] = {}
        # device -> tag -> (новое значение, момент, когда оно станет видимым)
        self._pending: dict[str, dict[str, tuple[int, float]]] = {}
        # Каналы без feedback (сцены): команду принимают, читать нечего.
        self._no_feedback: set[tuple[str, str]] = set()
        self._seed()

    def _seed(self) -> None:
        for room in DEFAULT_ROOMS:
            profile = ROOM_PROFILES.get(room, {"lights": 4, "curtains": 1, "fcus": 1, "scenes": 2})
            device = DEVICE_TEMPLATE.format(room=room)
            self._current[device] = _channels_for(**profile)
            self._pending[device] = {}
            for i in range(1, profile["scenes"] + 1):
                self._no_feedback.add((device, f"Scene_{i}"))

    # --- Внутреннее -------------------------------------------------------

    def _settle(self, device: str) -> None:
        """Применить отложенные изменения, которым пришло время."""
        now = time.monotonic()
        pending = self._pending.get(device, {})
        for tag, (value, at) in list(pending.items()):
            if now >= at:
                self._current[device][tag] = value
                del pending[tag]

    def _latency(self) -> float:
        low, high = self.latency_range
        if high <= low:
            return low
        # Без random: детерминированный разброс по счётчику. Тесты не должны
        # зависеть от генератора, но и мгновенным подтверждение быть не должно.
        self._tick = getattr(self, "_tick", 0) + 1
        span = high - low
        return low + span * ((self._tick * 0.37) % 1.0)

    # --- Протокол ---------------------------------------------------------

    def set_value(self, device: str, channel: str, value) -> bool:
        """C_<tag>. Возвращает status для ответа: True/False."""
        with self._lock:
            if device not in self._current:
                return False
            if not channel.startswith("C_"):
                return False
            tag = channel[2:]
            known = tag in self._current[device]
            if not known:
                return False
            try:
                numeric = int(str(value))
            except (TypeError, ValueError):
                return False
            # Сцена состояния не имеет: команду принимаем, feedback не трогаем.
            if (device, tag) in self._no_feedback:
                return True
            self._pending[device][tag] = (numeric, time.monotonic() + self._latency())
            return True

    def get_value(self, device: str, feedback: str) -> tuple[bool, str | None]:
        """
        F_<tag>. Возвращает (устройство_найдено, значение_строкой | None).

        None означает «тег не найден» — вызывающий отдаст строку "undefined",
        тот самый недокументированный дискриминатор из прозвона.
        """
        with self._lock:
            if device not in self._current:
                return False, None
            self._settle(device)
            if not feedback.startswith("F_"):
                return True, None
            tag = feedback[2:]
            if (device, tag) in self._no_feedback:
                return True, None
            if tag not in self._current[device]:
                return True, None
            return True, str(self._current[device][tag])


# --- HTTP-слой -------------------------------------------------------------

_BAD_REQUEST = '{"requestID":null, "status":false}'


def _status_body(request_id, status: bool) -> str:
    # Конкатенация, а не json.dumps: сервер собирает ответ именно так, отсюда
    # и строковый status, и незаэкранированный requestID.
    return '{ "requestID" : "' + str(request_id) + '", "status" : "' + str(status).lower() + '" }'


def _value_body(request_id, value: str) -> str:
    return (
        '{ "requestID" : "'
        + str(request_id)
        + '", "status" : "true", "value" : "'
        + value
        + '" }'
    )


def build_response(emulator: IridiEmulator, raw_body: bytes) -> str:
    """Ровно логика cbRequest из скрипта iRidi. Вынесена для тестов."""
    if not raw_body:
        return _BAD_REQUEST
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _BAD_REQUEST
    if not isinstance(payload, dict):
        return _BAD_REQUEST

    verb = payload.get("request")
    device = payload.get("device")
    # Регистрозависимо и требует оба ключа — иначе «плохой запрос».
    if verb not in ("GET", "SET") or device is None:
        return _BAD_REQUEST

    # requestID отсутствует → в ответе окажется строка "undefined": скрипт
    # клеит undefined в шаблон, а не подставляет null.
    request_id = payload.get("requestID", "undefined")

    # Непустой subdevice склеивается с тегом и ломает поиск — как на объекте.
    subdevice = payload.get("subdevice") or ""

    if verb == "SET":
        channel = payload.get("channel")
        if not channel:
            return _status_body(request_id, False)
        tag = f"{subdevice}:{channel}" if subdevice else channel
        ok = emulator.set_value(device, tag, payload.get("value"))
        return _status_body(request_id, ok)

    feedback = payload.get("feedback")
    if not feedback:
        return _status_body(request_id, False)
    tag = f"{subdevice}:{feedback}" if subdevice else feedback
    found, value = emulator.get_value(device, tag)
    if not found:
        return _status_body(request_id, False)
    return _value_body(request_id, value if value is not None else "undefined")


class _Handler(BaseHTTPRequestHandler):
    emulator: IridiEmulator = None  # проставляется фабрикой
    server_version = "iRidium Server"
    sys_version = ""

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        body = build_response(self.emulator, raw).encode("utf-8")
        # ВСЕГДА 200 — даже на мусор. Ошибка живёт в теле.
        self.send_response(200)
        self.send_header("Content-Type", "text/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # Метод не влияет ни на что — сервер смотрит только в тело.
    do_GET = do_POST = do_PUT = _handle

    def log_message(self, *args) -> None:  # тишина в тестах
        pass


def serve(host: str = "0.0.0.0", port: int = 1085, *, latency_range=DEFAULT_LATENCY_RANGE):
    """Поднять эмулятор. Возвращает (сервер, эмулятор) — сервер уже слушает."""
    emulator = IridiEmulator(latency_range=latency_range)
    handler = type("BoundHandler", (_Handler,), {"emulator": emulator})
    httpd = ThreadingHTTPServer((host, port), handler)
    return httpd, emulator


def serve_in_thread(port: int = 0, *, latency_range=DEFAULT_LATENCY_RANGE):
    """Поднять в фоне на свободном порту — для тестов."""
    httpd, emulator = serve("127.0.0.1", port, latency_range=latency_range)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, emulator, httpd.server_address[1]


if __name__ == "__main__":
    import os

    port = int(os.getenv("IRIDI_EMULATOR_PORT", "1085"))
    httpd, _ = serve(port=port)
    print(f"iRidi emulator on :{port}", flush=True)
    httpd.serve_forever()
