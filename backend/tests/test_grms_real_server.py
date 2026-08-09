"""
Проверка против БОЕВОГО iRidi (80.64.105.68:1085).

По умолчанию ПРОПУСКАЕТСЯ: тест ходит в интернет к чужому железу, и в обычном
прогоне это недопустимо — набор обязан быть воспроизводимым и не зависеть от
чужой сети. Запуск осознанный:

    GRMS_REAL_SERVER=1 pytest tests/test_grms_real_server.py -q

Что здесь доказывается и что НЕ доказывается.

ДОКАЗЫВАЕТСЯ: адаптер и исполнитель коннектора разговаривают с настоящим
сервером — конверт доезжает, ответ разбирается, поправки G0 (пустой subdevice,
чтение по POST, дискриминатор "undefined") верны на живом железе.

НЕ ДОКАЗЫВАЕТСЯ: подтверждение по feedback. На этом стенде оно непроверяемо —
все теги возвращают `false` и после успешного SET не меняются (прозвон G0,
docs/grms/iridi-probe.md §7). Это ЗАФИКСИРОВАННОЕ СОСТОЯНИЕ СТЕНДА, а не дефект
нашего кода: цикл подтверждения проверяется на эмуляторе, который отдаёт живой
feedback.

Тест намеренно НЕ делает SET на боевых номерах: канал `C_*` существует только
проверкой реальной записью, и сплошная проверка дёргала бы свет и шторы в живых
комнатах. Транспорт доказывается чтением, а запись — на неэталонном канале
уставки, который безобиден и самовосстанавливается.
"""

from __future__ import annotations

import os

import pytest

from apps.grms.transport import adapter
from itv_connector.executor import Endpoint, execute

REAL = os.getenv("GRMS_REAL_SERVER") == "1"
pytestmark = pytest.mark.skipif(
    not REAL, reason="ходит к боевому iRidi; запускать осознанно: GRMS_REAL_SERVER=1"
)

BASE = os.getenv("GRMS_REAL_URL", "http://80.64.105.68:1085")
DEVICE = "Modbus TCP Server (Slave mode) 701"


@pytest.fixture
def endpoints():
    return {"iridi": Endpoint(base_url=BASE, timeout_ms=8000)}


def _run(body: dict, endpoints) -> dict:
    request_id = body["requestID"]
    return execute(
        adapter.envelope(request_id=request_id, body=body, timeout_ms=8000, ttl_ms=10000),
        endpoints,
    )


def test_transport_reaches_the_real_server(endpoints):
    request_id = adapter.new_request_id()
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=request_id)
    raw = _run(body, endpoints)

    assert raw["ok"] is True, f"транспорт не дошёл: {raw.get('error')}"
    assert raw["status_code"] == 200, "iRidi ВСЕГДА отвечает 200"

    result = adapter.parse_response(raw["raw_body"], request_id=request_id, is_read=True)
    assert result.ok, f"ответ не разобрался: {raw['raw_body']!r}"


def test_empty_subdevice_is_required_on_the_real_server(endpoints):
    """§8.1 прозвона на живом железе: «Custom» ломает адресацию тега."""
    empty_id = adapter.new_request_id()
    empty = adapter.parse_response(
        _run(adapter.build_read(device=DEVICE, feedback="F_DND", request_id=empty_id), endpoints)["raw_body"],
        request_id=empty_id,
        is_read=True,
    )
    assert empty.ok, "с пустым subdevice чтение обязано работать"

    custom_id = adapter.new_request_id()
    custom = adapter.parse_response(
        _run(
            adapter.build_read(
                device=DEVICE, feedback="F_DND", request_id=custom_id, subdevice="Custom"
            ),
            endpoints,
        )["raw_body"],
        request_id=custom_id,
        is_read=True,
    )
    assert custom.error == adapter.CHANNEL_NOT_FOUND, "«Custom» обязан ломать адресацию"


def test_unknown_channel_discriminator_holds_on_real_hardware(endpoints):
    """Дискриминатор "undefined" — недокументированный, поэтому проверяем."""
    request_id = adapter.new_request_id()
    raw = _run(
        adapter.build_read(device=DEVICE, feedback="F_NOPE 99", request_id=request_id), endpoints
    )
    result = adapter.parse_response(raw["raw_body"], request_id=request_id, is_read=True)
    assert result.error == adapter.CHANNEL_NOT_FOUND


def test_unknown_device_is_distinguished_from_unknown_channel(endpoints):
    request_id = adapter.new_request_id()
    raw = _run(
        adapter.build_read(
            device="Modbus TCP Server (Slave mode) 999", feedback="F_DND", request_id=request_id
        ),
        endpoints,
    )
    result = adapter.parse_response(raw["raw_body"], request_id=request_id, is_read=True)
    assert result.error == adapter.DEVICE_NOT_FOUND


def test_feedback_is_still_dead_on_the_real_stand(endpoints):
    """
    СТОП-ТОЧКА, зафиксированная как тест, а не как абзац в отчёте.

    Пока это верно, гостевой цикл подтверждения на боевом стенде собрать
    нельзя. Когда ПНР поднимут обмен с GRMS, тест УПАДЁТ — и это будет хорошая
    новость: значит стенд ожил и пора перепроверять цикл на реальном железе.
    """
    dead = []
    for feedback in ("F_DND", "F_Light 1", "F_FCU_Setpoint 1", "F_FCU_Temperature 1"):
        request_id = adapter.new_request_id()
        raw = _run(
            adapter.build_read(device=DEVICE, feedback=feedback, request_id=request_id), endpoints
        )
        result = adapter.parse_response(raw["raw_body"], request_id=request_id, is_read=True)
        dead.append((feedback, result.value))

    assert all(value == "false" for _, value in dead), (
        "Стенд ожил — feedback отдаёт значения. Это НЕ поломка теста: "
        f"перепроверить цикл подтверждения на живом железе. Прочитано: {dead}"
    )


def test_set_is_accepted_by_the_real_server(endpoints):
    """
    Запись на БЕЗОБИДНОМ канале и НЕ в эталонной комнате типа.

    Уставка фанкойла выбрана намеренно: она не мигает светом и не двигает шторы
    в живом номере. Сплошную проверку каналов C_* здесь не делаем — их
    существование определяется только реальной записью.
    """
    request_id = adapter.new_request_id()
    body = adapter.build_set(
        device="Modbus TCP Server (Slave mode) 202",
        channel="C_FCU_Setpoint 1",
        value=22,
        request_id=request_id,
    )
    raw = _run(body, endpoints)
    assert raw["ok"] is True, f"транспорт не дошёл: {raw.get('error')}"

    result = adapter.parse_response(raw["raw_body"], request_id=request_id, is_read=False)
    assert result.ok, f"SET не принят: {raw['raw_body']!r}"
