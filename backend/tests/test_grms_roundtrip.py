"""
Round-trip: backend → коннектор → iRidi → SET → перечитывание → подтверждение.

Проверяется ТРУБА ЦЕЛИКОМ, а не её звенья по отдельности. Половинчатая проверка
(«конверт ушёл в группу») не доказала бы ничего: между backend и подтверждённым
состоянием четыре звена, и ломаться они умеют независимо.

Настоящие здесь: адаптер, транспорт с корреляцией по requestID, ИСПОЛНИТЕЛЬ
коннектора из connector/itv_connector/executor.py, эмулятор iRidi, журнал.
Подменён ровно один кусок — WS-клиент коннектора (`client.py`): вместо сокета
задания забираются из той же группы Channels, в которую пишет backend. Причина
честная: поднимать в тесте вторую ASGI-петлю ради проверки сокета незачем,
аутентификация и маршрутизация сокета проверены отдельно в test_grms_connector.

ГЛАВНОЕ, что здесь доказывается: подтверждение НЕ СОБРАЛОСЬ БЫ одним чтением.
Эмулятор отдаёт feedback с задержкой, как настоящий Modbus-опрос, и первое
перечитывание возвращает старое значение.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.grms.transport import adapter
from apps.grms.services import commands
from apps.grms.consumers import group_name
from apps.grms.transport.emulator import serve_in_thread
from apps.hotels.models import OnPremNode
from apps.hotels.services.onprem import register_node
from itv_connector.executor import Endpoint, execute

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

DEVICE = "Modbus TCP Server (Slave mode) 701"

# Подтверждение должно успеть, но НЕ с первой попытки: задержка эмулятора
# заведомо больше первой паузы (0.2 с) и заведомо меньше суммы окна.
EMULATOR_LATENCY = (0.35, 0.55)
FAST_DELAYS = (0.2, 0.5, 1.0)


class FakeConnectorRuntime:
    """
    Коннектор без сокета: слушает ту же группу Channels и исполняет задания
    НАСТОЯЩИМ исполнителем. Всё, что ниже группы, — боевой код.
    """

    def __init__(self, hotel_id: str, endpoints: dict):
        self.hotel_id = hotel_id
        self.endpoints = endpoints
        self.seen: list[dict] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._ready = threading.Event()

    def start(self):
        self._thread.start()
        assert self._ready.wait(timeout=10), "коннектор не подписался на группу"

    def stop(self):
        """
        Останов сигнальным конвертом, а не отменой receive().

        Отменять `receive()` у channels_redis нельзя: сообщение, уже снятое с
        очереди в момент отмены, теряется. Первая версия насоса крутила
        `wait_for(receive, 0.2)`, и ровно на этом один ответ пропадал —
        тест падал с TTL_EXPIRED там, где труба была исправна.
        """
        self._stop.set()
        async_to_sync(get_channel_layer().group_send)(
            group_name(self.hotel_id),
            {"type": "connector.dispatch", "envelope": {"__stop__": True}, "reply_to": ""},
        )
        self._thread.join(timeout=10)

    def _run(self):
        async_to_sync(self._pump)()

    async def _pump(self):
        # Своя петля — свой экземпляр слоя: делить его между event loop'ами
        # нельзя, соединение Redis привязано к петле.
        from channels_redis.core import RedisChannelLayer

        layer = RedisChannelLayer(hosts=settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"])
        channel = await layer.new_channel()
        await layer.group_add(group_name(self.hotel_id), channel)
        self._ready.set()

        while True:
            message = await layer.receive(channel)
            envelope = message["envelope"]
            if envelope.get("__stop__"):
                return
            self.seen.append(envelope)
            response = await asyncio.get_running_loop().run_in_executor(
                None, execute, envelope, self.endpoints
            )
            await layer.send(message["reply_to"], {"type": "connector.reply", "payload": response})


@pytest.fixture
def wired(crystal):
    """Отель с зарегистрированным живым узлом, коннектором и эмулятором."""
    httpd, emulator, port = serve_in_thread(latency_range=EMULATOR_LATENCY)

    node, _key = register_node(crystal, name="grms-box", purpose="grms")
    with tenant_context(crystal):
        # Узел «жив»: без свежей отметки транспорт сразу ответит CONNECTOR_OFFLINE.
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now())

    runtime = FakeConnectorRuntime(
        str(crystal.pk), {"iridi": Endpoint(base_url=f"http://127.0.0.1:{port}", timeout_ms=2000)}
    )
    runtime.start()
    try:
        yield {"hotel": crystal, "emulator": emulator, "connector": runtime, "port": port}
    finally:
        runtime.stop()
        httpd.shutdown()


# --- Главный сценарий -------------------------------------------------------


def test_command_reaches_the_device_and_is_confirmed_by_feedback(wired):
    hotel = wired["hotel"]

    outcome = commands.send_command(
        hotel,
        device=DEVICE,
        channel="C_Light 1",
        value=1,
        feedback="F_Light 1",
        room="701",
        confirm_delays=FAST_DELAYS,
    )

    assert outcome["result"] == commands.RESULT_CONFIRMED
    assert outcome["value"] == 1

    # Труба прошла целиком: конверт дошёл до коннектора и был не один —
    # SET плюс минимум одно перечитывание.
    kinds = [envelope["body"]["request"] for envelope in wired["connector"].seen]
    assert kinds[0] == "SET"
    assert "GET" in kinds[1:], "после SET обязано быть перечитывание"


def test_a_single_immediate_read_would_have_failed(wired):
    """
    Обоснование цикла перечитывания, а не одного чтения.

    Сразу после SET feedback ещё старый — ровно как на объекте, где значение
    приносит лишь следующий цикл опроса Modbus. Прочитав один раз, мы объявили
    бы исправную команду неподтверждённой и показали гостю «не удалось» на
    работающем выключателе.
    """
    hotel = wired["hotel"]

    before = commands.read(hotel, device=DEVICE, feedback="F_Light 2", room="701")
    assert before.ok and before.value == 0

    request_id = adapter.new_request_id()
    body = adapter.build_set(
        device=DEVICE, channel="C_Light 2", value=1, request_id=request_id
    )
    from apps.grms.transport import transport

    raw = transport.send(hotel, adapter.envelope(request_id=request_id, body=body))
    assert adapter.parse_response(
        raw["raw_body"], request_id=request_id, is_read=False
    ).ok, "SET обязан быть принят"

    immediately = commands.read(hotel, device=DEVICE, feedback="F_Light 2", room="701")
    assert immediately.value == 0, "feedback не имеет права успеть — иначе тест ничего не ловит"

    time.sleep(1.0)
    later = commands.read(hotel, device=DEVICE, feedback="F_Light 2", room="701")
    assert later.value == 1


def test_setpoint_round_trip_carries_the_value(wired):
    """Не только 0/1: диапазонная величина обязана доехать значением."""
    outcome = commands.send_command(
        wired["hotel"],
        device=DEVICE,
        channel="C_FCU_Setpoint 1",
        value=27,
        feedback="F_FCU_Setpoint 1",
        room="701",
        confirm_delays=FAST_DELAYS,
    )
    assert outcome["result"] == commands.RESULT_CONFIRMED
    assert outcome["value"] == 27


def test_scene_needs_no_confirmation(wired):
    """
    У сцены нет feedback (проверено на боевом сервере). Успешная отправка и
    есть успех — это свойство протокола, а не поблажка.
    """
    outcome = commands.send_command(
        wired["hotel"], device=DEVICE, channel="C_Scene_1", value=1, feedback="", room="701"
    )
    assert outcome["result"] == commands.RESULT_ACCEPTED
    # Перечитывания не было вовсе.
    assert [e["body"]["request"] for e in wired["connector"].seen] == ["SET"]


def test_unconfirmed_when_feedback_never_catches_up(wired):
    """
    Окно подтверждения короче задержки оборудования → `unconfirmed`.

    Это НЕ то же самое, что `failed`: команда ушла в оборудование и могла
    сработать. Схлопнув их в «ошибку», мы показали бы гостю «не получилось»
    там, где получилось.
    """
    outcome = commands.send_command(
        wired["hotel"],
        device=DEVICE,
        channel="C_Light 3",
        value=1,
        feedback="F_Light 3",
        room="701",
        confirm_delays=(0.05, 0.05),  # заведомо меньше задержки эмулятора
    )
    assert outcome["result"] == commands.RESULT_UNCONFIRMED
    # Показываем ФАКТИЧЕСКОЕ состояние, а не желаемое.
    assert outcome["value"] == 0


def test_unknown_channel_fails_without_touching_state(wired):
    outcome = commands.send_command(
        wired["hotel"], device=DEVICE, channel="C_Nope 99", value=1,
        feedback="F_Nope 99", room="701", confirm_delays=FAST_DELAYS,
    )
    assert outcome["result"] == commands.RESULT_FAILED
    assert outcome["error"] == adapter.DEVICE_OR_CHANNEL_NOT_FOUND


def test_reading_an_unknown_channel_is_distinguished_from_a_dead_device(wired):
    """На ЧТЕНИИ два случая различимы — в отличие от записи."""
    missing_channel = commands.read(wired["hotel"], device=DEVICE, feedback="F_Nope 99")
    assert missing_channel.error == adapter.CHANNEL_NOT_FOUND

    missing_device = commands.read(
        wired["hotel"], device="Modbus TCP Server (Slave mode) 999", feedback="F_DND"
    )
    assert missing_device.error == adapter.DEVICE_NOT_FOUND


# --- Отсутствие связи -------------------------------------------------------


def test_offline_node_fails_fast_and_does_not_queue(crystal):
    """
    Задания на отключённый узел НЕ копятся: держать гостя пять секунд ради
    заведомо известного ответа незачем, а накопленная очередь после
    восстановления связи вывалила бы команды в номер (ТЗ §6).
    """
    register_node(crystal, name="grms-box", purpose="grms")  # без отметки «жив»

    started = time.monotonic()
    outcome = commands.send_command(
        crystal, device=DEVICE, channel="C_Light 1", value=1, feedback="F_Light 1"
    )
    elapsed = time.monotonic() - started

    assert outcome["result"] == commands.RESULT_FAILED
    assert outcome["error"] == adapter.CONNECTOR_OFFLINE
    assert elapsed < 2.0, "отказ обязан быть мгновенным, а не по таймауту"


# --- Журнал -----------------------------------------------------------------


def test_every_command_lands_in_the_journal_with_diagnostics(wired):
    """
    Из этих записей в G6 собирается диагностика инженера (ТЗ §14): комната,
    устройство, канал, отправленное значение, ответ, длительность, статус.
    """
    hotel = wired["hotel"]
    commands.send_command(
        hotel, device=DEVICE, channel="C_Light 4", value=1, feedback="F_Light 4",
        room="701", confirm_delays=FAST_DELAYS,
    )

    with tenant_context(hotel):
        entry = AuditLog.objects.filter(action="grms.command").order_by("-created_at").first()

    assert entry is not None, "команда обязана попасть в журнал"
    payload = entry.payload
    for field in ("requestID", "device", "command", "feedback", "sent", "raw_response",
                  "duration_ms", "result", "room"):
        assert field in payload, f"в журнале нет поля {field}"

    assert payload["device"] == DEVICE
    assert payload["command"] == "C_Light 4"
    assert payload["sent"] == 1
    assert payload["room"] == "701"
    assert payload["result"] == commands.RESULT_CONFIRMED
    # Сырое тело сохранено как есть — в нём должен быть наш requestID.
    assert payload["requestID"] in payload["raw_response"]


def test_reads_are_journalled_too(wired):
    commands.read(wired["hotel"], device=DEVICE, feedback="F_DND", room="701")
    with tenant_context(wired["hotel"]):
        assert AuditLog.objects.filter(action="grms.read").exists()


def test_journal_is_isolated_between_hotels(wired, aurora):
    commands.send_command(
        wired["hotel"], device=DEVICE, channel="C_Light 5", value=1,
        feedback="F_Light 5", room="701", confirm_delays=FAST_DELAYS,
    )
    with tenant_context(aurora):
        assert not AuditLog.objects.filter(action="grms.command").exists()
