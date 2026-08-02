"""
Адаптер протокола iRidi: перевод команды и нормализация ответа.

Тесты не ходят в сеть и не трогают базу — адаптер это позволяет намеренно.
Каждая проверка привязана к пункту прозвона боевого сервера
(docs/grms/iridi-probe.md): это не выдуманные требования, а поведение, снятое
с живого стенда.
"""

from __future__ import annotations

import pytest

from apps.grms import adapter

GOOD_ID = "ce3ba8ef-a30b-4812-97c6-37e90ccb4d1c"
DEVICE = "Modbus TCP Server (Slave mode) 701"


# --- requestID: защита от инъекции (§3 прозвона) ----------------------------


def test_new_request_id_passes_own_guard():
    adapter.validate_request_id(adapter.new_request_id())


@pytest.mark.parametrize(
    "bad",
    [
        'a" , "injected" : "yes',  # ровно то, что сработало на боевом сервере
        "not-a-uuid",
        "",
        "ce3ba8ef-a30b-1812-97c6-37e90ccb4d1c",  # версия 1, а не 4
        "ce3ba8ef-a30b-4812-c7c6-37e90ccb4d1c",  # неверный вариант
        "CE3BA8EF-A30B-4812-97C6-37E90CCB4D1C",  # верхний регистр
        None,
        123,
    ],
)
def test_request_id_guard_rejects_anything_but_uuid4(bad):
    """
    Сервер возвращает requestID эхом БЕЗ экранирования — проверено на живом
    стенде: строка `a" , "injected" : "yes` добавила в ответ лишнее поле.
    Значит любая строка, дошедшая сюда из данных, управляет телом ответа.
    """
    with pytest.raises(adapter.ProtocolError):
        adapter.validate_request_id(bad)


def test_injection_cannot_reach_the_wire():
    """Guard стоит на пути сборки запроса, а не только отдельной функцией."""
    with pytest.raises(adapter.ProtocolError):
        adapter.build_set(
            device=DEVICE, channel="C_Light 1", value=1, request_id='x" , "y" : "z'
        )
    with pytest.raises(adapter.ProtocolError):
        adapter.build_read(device=DEVICE, feedback="F_Light 1", request_id="oops")


# --- Сборка запроса ---------------------------------------------------------


def test_set_body_has_empty_subdevice_by_default():
    """
    §8.1 прозвона: "Custom" из ТЗ и Postman ломает адресацию — сервер ищет
    несуществующий тег «Custom:F_DND». На этом объекте subdevice пуст.
    """
    body = adapter.build_set(device=DEVICE, channel="C_Light 1", value=1, request_id=GOOD_ID)
    assert body["subdevice"] == ""
    assert body["request"] == "SET"
    assert body["channel"] == "C_Light 1"
    assert body["value"] == 1


def test_subdevice_is_configurable_for_other_sites():
    body = adapter.build_read(
        device=DEVICE, feedback="F_DND", request_id=GOOD_ID, subdevice="Custom"
    )
    assert body["subdevice"] == "Custom"


def test_envelope_reads_with_post_not_get_with_body():
    """
    §4 прозвона: сервер игнорирует HTTP-метод и смотрит только на body.request.
    Поэтому чтение идёт POST'ом, и требование ТЗ §7 «клиент обязан уметь GET
    с телом» этим снимается.
    """
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=GOOD_ID)
    env = adapter.envelope(request_id=GOOD_ID, body=body)
    assert env["method"] == "POST"
    assert env["path"] == "/"
    assert env["body"]["request"] == "GET"


def test_envelope_names_endpoint_and_never_an_address():
    """Backend не имеет права называть адрес внутренней сети — только endpoint."""
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=GOOD_ID)
    env = adapter.envelope(request_id=GOOD_ID, body=body)
    assert env["endpoint"] == "iridi"
    assert "baseUrl" not in env and "url" not in env and "host" not in env


def test_ttl_must_exceed_timeout():
    body = adapter.build_read(device=DEVICE, feedback="F_DND", request_id=GOOD_ID)
    with pytest.raises(adapter.ProtocolError):
        adapter.envelope(request_id=GOOD_ID, body=body, timeout_ms=3000, ttl_ms=3000)


# --- Нормализация ответа ----------------------------------------------------


def test_status_and_value_come_as_strings():
    """§2 прозвона: status и value — СТРОКИ, а не булев и число."""
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "true", "value" : "1" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.ok and result.value == 1  # нормализовано в число


def test_undefined_value_means_channel_not_found():
    """
    §6.1: недокументированный дискриминатор. Без этой ветки гость увидел бы
    строку «undefined» как состояние выключателя.
    """
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "true", "value" : "undefined" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.failed and result.error == adapter.CHANNEL_NOT_FOUND


def test_status_false_on_read_means_device_not_found():
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "false" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.error == adapter.DEVICE_NOT_FOUND


def test_status_false_on_write_cannot_tell_device_from_channel():
    """
    Ограничение ПРОТОКОЛА, а не разбора: на записи сервер отвечает одинаково
    и на несуществующее устройство, и на несуществующий канал.
    """
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "false" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=False)
    assert result.error == adapter.DEVICE_OR_CHANNEL_NOT_FOUND


def test_bad_request_form_is_understood():
    """Вторая форма ответа: status БУЛЕВ, requestID null. Некоррелируема."""
    result = adapter.parse_response(
        '{"requestID":null, "status":false}', request_id=GOOD_ID, is_read=True
    )
    assert result.failed and result.error == adapter.BAD_RESPONSE


def test_missing_request_id_answer_is_not_correlated():
    """Ответ со строкой "undefined" вместо requestID применять нельзя."""
    raw = '{ "requestID" : "undefined", "status" : "true", "value" : "1" }'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.error == adapter.BAD_RESPONSE


def test_foreign_request_id_is_rejected():
    """
    Корреляция строго по requestID из ТЕЛА. Цена ошибки — состояние ЧУЖОГО
    канала, показанное гостю как своё.
    """
    other = "11111111-2222-4333-8444-555555555555"
    raw = f'{{ "requestID" : "{other}", "status" : "true", "value" : "1" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.error == adapter.BAD_RESPONSE


def test_broken_json_keeps_raw_body_for_the_journal():
    """Ответ, испорченный инъекцией, обязан долететь до журнала как есть."""
    raw = '{ "requestID" : "a" , "injected" : "yes", "status" : "true" '
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.error == adapter.BAD_RESPONSE
    assert result.raw == raw


def test_set_success_is_not_a_state_confirmation():
    """
    status "true" на SET означает лишь ПРИЁМ команды. Значения в ответе нет —
    и подтверждать состояние нечем, только перечитыванием.
    """
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "true" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=False)
    assert result.ok and result.value is None


def test_non_integer_value_is_kept_as_string():
    raw = f'{{ "requestID" : "{GOOD_ID}", "status" : "true", "value" : "23.5" }}'
    result = adapter.parse_response(raw, request_id=GOOD_ID, is_read=True)
    assert result.value == "23.5"
