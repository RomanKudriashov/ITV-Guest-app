"""
Коннектор: allowlist, исполнение в LAN, аутентификация узла.

Проверяется РЕАЛЬНЫЙ исполнитель из `connector/itv_connector/executor.py`, а не
его копия: коннектор лежит в этом же монорепо и подключён к backend'у по
PYTHONPATH только ради тестов. Проверять копию бессмысленно — расходиться она
начнёт ровно тогда, когда это станет важно.

Отдельно проверяется эмулятор: если он неверно повторяет квирки, все
round-trip-тесты поверх него доказывают не то, что нужно.
"""

from __future__ import annotations

import json
import urllib.request

import pytest
from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator

from apps.grms import adapter
from apps.grms.emulator import serve_in_thread
from apps.hotels.onprem import register_node, revoke_key
from itv_connector.executor import Endpoint, execute

DEVICE = "Modbus TCP Server (Slave mode) 701"
GOOD_ID = "ce3ba8ef-a30b-4812-97c6-37e90ccb4d1c"


@pytest.fixture
def emulator():
    """Эмулятор на свободном порту. Задержка короткая — тесты не про неё."""
    httpd, emu, port = serve_in_thread(latency_range=(0.05, 0.1))
    yield f"http://127.0.0.1:{port}", emu
    httpd.shutdown()


@pytest.fixture
def endpoints(emulator):
    base, _ = emulator
    return {"iridi": Endpoint(base_url=base, timeout_ms=2000)}


def _envelope(body: dict, **over) -> dict:
    env = {
        "type": "connector.request",
        "requestID": GOOD_ID,
        "endpoint": "iridi",
        "method": "POST",
        "path": "/",
        "body": body,
        "timeout_ms": 2000,
        "ttl_ms": 5000,
    }
    env.update(over)
    return env


# --- Allowlist: последний рубеж перед внутренней сетью ----------------------


def test_unknown_endpoint_is_refused_even_if_backend_asked(endpoints):
    """
    Список endpoint'ов — свойство ОБЪЕКТА, а не облака. Коннектор не доверяет
    backend в вопросе адресов: иначе ошибка или взлом в облаке означали бы
    произвольные запросы во внутреннюю сеть гостиницы.
    """
    response = execute(_envelope({}, endpoint="locks"), endpoints)
    assert response["ok"] is False
    assert response["error"]["code"] == adapter.ENDPOINT_UNKNOWN


def test_method_outside_allowlist_is_refused(endpoints):
    endpoints["iridi"].allowed_methods = ("POST",)
    response = execute(_envelope({}, method="DELETE"), endpoints)
    assert response["error"]["code"] == adapter.REQUEST_REJECTED


def test_path_outside_allowlist_is_refused(endpoints):
    response = execute(_envelope({}, path="/admin"), endpoints)
    assert response["error"]["code"] == adapter.REQUEST_REJECTED


def test_oversized_request_is_refused(endpoints):
    endpoints["iridi"].max_request_bytes = 64
    response = execute(_envelope({"junk": "x" * 500}), endpoints)
    assert response["error"]["code"] == adapter.REQUEST_REJECTED


def test_unreachable_endpoint_reports_transport_failure():
    endpoints = {"iridi": Endpoint(base_url="http://127.0.0.1:9", timeout_ms=800)}
    response = execute(_envelope({"request": "GET"}), endpoints)
    assert response["ok"] is False
    assert response["error"]["code"] in (adapter.ENDPOINT_UNREACHABLE, adapter.TIMEOUT)


# --- Исполнение -------------------------------------------------------------


def test_connector_returns_raw_body_without_parsing(endpoints):
    """
    Сырое тело СТРОКОЙ: сервер собирает ответ конкатенацией и умеет отдать
    невалидный JSON. Разбор — задача адаптера, в журнал должно лечь то, что
    реально пришло.
    """
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=GOOD_ID)
    response = execute(_envelope(body), endpoints)

    assert response["ok"] is True
    assert response["status_code"] == 200
    assert isinstance(response["raw_body"], str)
    assert GOOD_ID in response["raw_body"]


def test_connector_knows_nothing_about_iridi(endpoints):
    """
    В ответе коннектора нет ни одного доменного поля: он транспорт. Если тут
    появится `value` или `status`, значит протокол потёк в транспортный слой.
    """
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=GOOD_ID)
    response = execute(_envelope(body), endpoints)
    assert set(response) >= {"requestID", "ok", "status_code", "raw_body"}
    assert "value" not in response and "status" not in response


# --- Эмулятор: если он врёт, врут и все тесты поверх него -------------------


def _call(base: str, payload: dict, method: str = "POST") -> str:
    request = urllib.request.Request(
        base + "/",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200, "iRidi ВСЕГДА отвечает 200"
        return response.read().decode()


def test_emulator_always_answers_200_even_on_garbage(emulator):
    base, _ = emulator
    assert _call(base, {}) == '{"requestID":null, "status":false}'


def test_emulator_reproduces_undefined_for_unknown_channel(emulator):
    base, _ = emulator
    raw = _call(base, {"requestID": "x", "request": "GET", "device": DEVICE,
                       "subdevice": "", "feedback": "F_NOPE 99"})
    assert '"value" : "undefined"' in raw


def test_emulator_breaks_on_nonempty_subdevice_exactly_like_the_real_server(emulator):
    """§8.1 прозвона: «Custom» ищет тег «Custom:F_DND», которого нет."""
    base, _ = emulator
    raw = _call(base, {"requestID": "x", "request": "GET", "device": DEVICE,
                       "subdevice": "Custom", "feedback": "F_DND"})
    assert '"value" : "undefined"' in raw


def test_emulator_ignores_http_method(emulator):
    """§4: смотрит только на body.request — чтение проходит и POST'ом, и GET'ом."""
    base, _ = emulator
    payload = {"requestID": "x", "request": "GET", "device": DEVICE,
               "subdevice": "", "feedback": "F_DND"}
    assert _call(base, payload, "POST") == _call(base, payload, "GET")


def test_emulator_request_verb_is_case_sensitive(emulator):
    base, _ = emulator
    raw = _call(base, {"requestID": "x", "request": "get", "device": DEVICE,
                       "subdevice": "", "feedback": "F_DND"})
    assert raw == '{"requestID":null, "status":false}'


def test_emulator_echoes_request_id_unescaped(emulator):
    """
    Дыра воспроизводится ОСОЗНАННО: именно на ней проверяется UUIDv4-guard
    адаптера. Эмулятор поднимается только локально.
    """
    base, _ = emulator
    raw = _call(base, {"requestID": 'x" , "injected" : "yes', "request": "GET",
                       "device": DEVICE, "subdevice": "", "feedback": "F_DND"})
    assert '"injected" : "yes"' in raw


def test_emulator_scene_has_no_feedback(emulator):
    """F_Scene_* не существует на боевом сервере — не должно и здесь."""
    base, _ = emulator
    raw = _call(base, {"requestID": "x", "request": "GET", "device": DEVICE,
                       "subdevice": "", "feedback": "F_Scene_1"})
    assert '"value" : "undefined"' in raw


def test_emulator_feedback_lags_behind_the_command(emulator):
    """
    САМОЕ ВАЖНОЕ свойство эмулятора.

    Немедленное перечитывание обязано вернуть СТАРОЕ значение — как на объекте,
    где feedback обновляется лишь следующим циклом опроса Modbus. Без этого
    подтверждение проходило бы с первой попытки и цикл перечитывания не
    проверялся бы вовсе.
    """
    import time

    base, _ = emulator
    before = _call(base, {"requestID": "a", "request": "GET", "device": DEVICE,
                          "subdevice": "", "feedback": "F_Light 1"})
    assert '"value" : "0"' in before

    _call(base, {"requestID": "b", "request": "SET", "device": DEVICE,
                 "subdevice": "", "channel": "C_Light 1", "value": 1})

    immediately = _call(base, {"requestID": "c", "request": "GET", "device": DEVICE,
                               "subdevice": "", "feedback": "F_Light 1"})
    assert '"value" : "0"' in immediately, "feedback не имеет права успеть"

    time.sleep(0.4)
    later = _call(base, {"requestID": "d", "request": "GET", "device": DEVICE,
                         "subdevice": "", "feedback": "F_Light 1"})
    assert '"value" : "1"' in later


# --- Аутентификация узла на канале -----------------------------------------


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_connector_socket_accepts_a_registered_node(crystal):
    from config.asgi import application

    _, key = register_node(crystal, name="grms-box", purpose="grms")

    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            "/ws/v1/onprem/connector",
            headers=[(b"authorization", f"Bearer {key}".encode())],
        )
        connected, _ = await communicator.connect(timeout=10)
        assert connected, "узел с валидным ключом обязан подключиться"
        hello = await communicator.receive_json_from(timeout=10)
        await communicator.disconnect()
        return hello

    hello = async_to_sync(scenario)()
    assert hello["type"] == "connector.hello"
    assert hello["hotel"] == crystal.subdomain


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_connector_socket_refuses_unknown_key():
    from config.asgi import application

    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            "/ws/v1/onprem/connector",
            headers=[(b"authorization", b"Bearer definitely-not-a-key")],
        )
        connected, _ = await communicator.connect(timeout=10)
        await communicator.disconnect()
        return connected

    assert async_to_sync(scenario)() is False


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_revoked_key_stops_working(crystal):
    """Отзыв ключа обязан закрывать канал, а не только REST-отметку."""
    from config.asgi import application

    node, key = register_node(crystal, name="grms-box", purpose="grms")
    revoke_key(str(node.pk))

    async def scenario():
        communicator = WebsocketCommunicator(
            application,
            "/ws/v1/onprem/connector",
            headers=[(b"authorization", f"Bearer {key}".encode())],
        )
        connected, _ = await communicator.connect(timeout=10)
        await communicator.disconnect()
        return connected

    assert async_to_sync(scenario)() is False
