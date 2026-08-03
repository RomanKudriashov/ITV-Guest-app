"""
Гостевой API управления номером: снапшот, команда, доверие, изоляция.

Труба здесь НАСТОЯЩАЯ: адаптер, транспорт с корреляцией по requestID,
исполнитель коннектора и эмулятор iRidi с отложенным feedback. Подменён ровно
WS-клиент коннектора — как и в round-trip (tests/grms_harness.py).

Главное, что здесь доказывается и чего нельзя проверить «по кусочкам»:

  * гостю не уходит НИ ОДНОГО технического поля — ни целиком, ни в обломках;
  * команда возвращается немедленно и в состоянии `pending`, а подтверждение
    приезжает потом (иначе весь прогон был бы бессмысленным);
  * когда связи нет, значения НЕ показываются — ни старые, ни любые;
  * подмена `controlId` не достаёт соседний номер;
  * демо-вход ослабляет РОВНО step-up и ничего больше.
"""

from __future__ import annotations

import time

import pytest

from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.grms import catalog, commands, inflight
from apps.grms.management.commands.seed_grms_demo import DEMO_PIN, DEMO_ROOM
from apps.hotels.models import HotelModule, OnPremNode
from tests.conftest import host_for
from tests.grms_harness import wire

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


# --- Оснастка ---------------------------------------------------------------


class GuestClient:
    """Тонкая обёртка: хост отеля и гостевой токен подставляются сами."""

    def __init__(self, client, hotel, token: str):
        self.client = client
        self.hotel = hotel
        self.token = token

    def _kwargs(self) -> dict:
        return {
            "HTTP_HOST": host_for(self.hotel),
            "HTTP_AUTHORIZATION": f"Bearer {self.token}",
        }

    def get(self, path: str):
        return self.client.get(path, **self._kwargs())

    def post(self, path: str, data=None):
        return self.client.post(
            path, data=data or {}, content_type="application/json", **self._kwargs()
        )


def _session(client, hotel, room: str = DEMO_ROOM) -> str:
    response = client.post(
        "/api/v1/guest/session",
        data={"room_number": room, "language": "ru"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


@pytest.fixture
def stand(crystal, settings):
    """Живой стенд: эмулятор с отложенным feedback + коннектор без сокета."""
    settings.CELERY_TASK_ALWAYS_EAGER = True
    context, finish = wire(crystal)
    yield context
    finish()


@pytest.fixture
def guest(client, crystal, stand):
    return GuestClient(client, crystal, _session(client, crystal))


@pytest.fixture
def queued(monkeypatch, settings):
    """
    Задача НЕ исполняется в запросе — она копится, как в проде.

    Без этой фикстуры доказать асинхронность нечем: в eager-режиме Celery
    выполняет задачу внутри вызова `.delay()`, то есть ровно внутри HTTP-запроса
    гостя, и тест «ответ пришёл быстро» мерил бы не то, что нужно. Здесь вызов
    ЗАПОМИНАЕТСЯ, и тест сам решает, когда его исполнить.
    """
    from apps.grms import tasks

    settings.CELERY_TASK_ALWAYS_EAGER = False
    calls: list[dict] = []
    monkeypatch.setattr(tasks.execute_room_command, "delay", lambda **kw: calls.append(kw))

    class Queue:
        def __init__(self, recorded):
            self.calls = recorded

        def run_all(self):
            while self.calls:
                tasks.execute_room_command(**self.calls.pop(0))

    return Queue(calls)


def _demo_entry(hotel, enabled: bool) -> None:
    with tenant_context(hotel):
        module = HotelModule.objects.get(code=HotelModule.Code.ROOM_CONTROL)
        config = dict(module.config or {})
        config["guest_entry_demo"] = enabled
        module.config = config
        module.save(update_fields=["config", "updated_at"])


def _controls(payload: dict) -> dict:
    return {
        control["controlId"]: control
        for zone in payload["zones"]
        for control in zone["controls"]
    }


def _wait_for(guest, control_id: str, predicate, timeout: float = 12.0) -> dict:
    """Дождаться состояния элемента: подтверждение приходит ПОСЛЕ ответа."""
    deadline = time.monotonic() + timeout
    control = {}
    while time.monotonic() < deadline:
        control = _controls(guest.get("/api/v1/guest/room/state").json())[control_id]
        if predicate(control):
            return control
        time.sleep(0.2)
    raise AssertionError(f"не дождались состояния {control_id}: {control}")


# --- Снапшот ----------------------------------------------------------------


def test_snapshot_shows_live_values_read_before_any_interaction(guest):
    """Значения приезжают из feedback, а не из конфигурации."""
    payload = guest.get("/api/v1/guest/room/state").json()

    assert payload["availability"] == "online"
    controls = _controls(payload)

    light = controls["light.living"]
    assert light["state"] == "confirmed"
    assert light["value"] in (0, 1)

    # Составной элемент — ОДИН controlId с объектом-значением, а не четыре
    # независимых: иначе фронт собирал бы фанкойл из кусков.
    ac = controls["ac.1"]
    assert set(ac["capabilities"]) == {"toggle", "fan_speed", "setpoint", "current_temp"}
    assert set(ac["value"]) == {"on", "fan_speed", "setpoint", "current_temp"}
    # Диапазон приезжает С СЕРВЕРА: ни 16, ни 32 на фронте не зашиты.
    assert ac["range"]["setpoint"] == {"min": 16, "max": 32, "step": 1}
    assert ac["range"]["fan_speed"] == {"min": 0, "max": 3, "step": 1}


def test_scene_never_looks_switched_on(guest):
    """У сцены feedback'а нет — состояния у неё не бывает."""
    scene = _controls(guest.get("/api/v1/guest/room/state").json())["scene.night"]
    assert scene["capabilities"] == ["trigger"]
    assert scene["value"] is None


def test_unbound_element_never_reaches_the_guest(guest):
    """
    Мастер-выключатель стоит в типе, но ни с чем не связан: переменной у ПНР
    нет. Кнопка, за которой нет оборудования, гостю не показывается.
    """
    assert "master.off" not in _controls(guest.get("/api/v1/guest/room/state").json())


def test_no_technical_fields_ever_leave_the_server(guest):
    """
    СТОРОЖ КОНТРАКТА §8.

    Проверяется двумя способами сразу, и это не перестраховка. По КЛЮЧАМ —
    чтобы не поймать `can_command` вместо `command`. По ЗНАЧЕНИЯМ — чтобы
    поймать имя канала, случайно уехавшее в чужое поле: технические имена в
    гостевом ответе не должны встречаться ни под каким ключом.
    """
    response = guest.get("/api/v1/guest/room/state")
    payload = response.json()

    forbidden_keys = {
        "channels",
        "command",
        "feedback",
        "subdevice",
        "trigger_value",
        "device_name_template",
        "requestID",
        "room_number",
        "endpoint",
        "device",
    }

    def walk(node, path="root"):
        if isinstance(node, dict):
            for key, value in node.items():
                assert key not in forbidden_keys, f"техническое поле «{key}» в {path}"
                walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(payload)

    body = response.content.decode()
    for fragment in ("C_Light", "F_Light", "C_FCU", "F_FCU", "C_DND", "F_DND", "Modbus"):
        assert fragment not in body, f"наружу утекло «{fragment}»"


def test_catalog_has_no_dimming_on_this_object(guest):
    """
    Честность под железо: диммирования, цветовой температуры и процента
    открытия шторы в номере нет, потому что таких переменных нет у ПНР.
    """
    controls = _controls(guest.get("/api/v1/guest/room/state").json())
    exposed = {c for control in controls.values() for c in control["capabilities"]}

    assert "level" not in exposed, "диммер появился там, где его нет в железе"
    assert "position" not in exposed, "процент открытия шторы появился из ниоткуда"
    # Шторы на этом объекте бинарные: 0-Close, 1-Open.
    assert controls["curtain.main"]["capabilities"] == ["toggle"]
    assert controls["curtain.blackout"]["capabilities"] == ["toggle"]


# --- Команда ----------------------------------------------------------------


def test_command_answers_immediately_and_confirms_later(guest, queued):
    """
    ЯДРО ПРОГОНА: ответ мгновенный, исполнение и подтверждение — вне запроса.

    Порог в 1.5 секунды выбран не «с запасом», а осмысленно: синхронный путь
    ждал бы цикл перечтения feedback (до ~3.7 с) и уложиться в него не смог бы
    в принципе. Проверка имеет силу ровно потому, что задача здесь НЕ
    выполняется внутри запроса — она лежит в очереди (фикстура `queued`).
    """
    started = time.monotonic()
    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    elapsed = time.monotonic() - started

    assert response.status_code == 202, response.content
    body = response.json()
    assert body["state"] == "pending"
    assert body["controlId"] == "light.living"
    assert body["commandId"]
    assert elapsed < 1.5, f"гостевой путь ждал железо {elapsed:.2f} с"
    assert queued.calls, "команда обязана уехать в очередь, а не исполниться в запросе"

    # Пока команда в полёте — «в процессе» и БЕЗ значения: показывать нечего.
    control = _controls(guest.get("/api/v1/guest/room/state").json())["light.living"]
    assert control["state"] == "pending"
    assert control["value"] is None

    queued.run_all()

    confirmed = _controls(guest.get("/api/v1/guest/room/state").json())["light.living"]
    assert confirmed["state"] == "confirmed"
    assert confirmed["value"] == 1


def test_a_command_that_expired_is_not_executed_later(guest, queued, crystal):
    """
    ТЗ §6: старые команды после восстановления связи НЕ выполняются.

    Иначе связь, вернувшаяся через минуту, вывалила бы в номер очередь
    накопленного: гость нажал свет, ушёл, а свет включился сам через десять
    минут.
    """
    before = _controls(guest.get("/api/v1/guest/room/state").json())["light.bathroom"]["value"]
    assert guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.bathroom", "value": 1}
    ).status_code == 202

    # Окно прошло: запись о команде в полёте истекла.
    inflight.finish(crystal.pk, _room_id(crystal), "light.bathroom")
    queued.run_all()

    after = _controls(guest.get("/api/v1/guest/room/state").json())["light.bathroom"]
    assert after["value"] == before, "протухшая команда всё-таки доехала до номера"


def test_second_tap_while_in_flight_does_not_queue_a_second_command(guest, queued):
    """Гость «дробью» не набивает очередь в оборудование."""
    first = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.entry", "value": 1}
    )
    assert first.status_code == 202

    second = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.entry", "value": 1}
    )
    assert second.status_code == 409
    assert second.json()["code"] == "command_in_flight"


def test_scene_is_accepted_not_faked_as_confirmed(guest, crystal):
    """Сцена: успешная отправка и есть результат, подтверждать нечем."""
    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "scene.night", "capability": "trigger"}
    )
    assert response.status_code == 202

    room_id = _room_id(crystal)
    deadline = time.monotonic() + 12
    while inflight.get(crystal.pk, room_id, "scene.night") and time.monotonic() < deadline:
        time.sleep(0.2)

    with platform_scope():
        entry = (
            AuditLog.all_objects.using("platform")
            .filter(action="grms.command")
            .order_by("-created_at")
            .first()
        )
    assert entry.payload["result"] == commands.RESULT_ACCEPTED


def test_unconfirmed_returns_the_element_to_its_actual_state(guest, stand, crystal):
    """
    Команда ушла, feedback не догнал за окно → элемент показывает ФАКТ.

    Именно это отличает `unconfirmed` от `failed` и именно поэтому их нельзя
    схлопывать в «ошибку»: команда в оборудование ушла и могла сработать.
    """
    # Задержка эмулятора заведомо больше окна подтверждения.
    stand["emulator"].latency_range = (30.0, 30.0)

    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.wardrobe", "value": 1}
    )
    assert response.status_code == 202

    control = _wait_for(guest, "light.wardrobe", lambda c: c["state"] != "pending", timeout=20)
    # Показано фактическое (ещё старое) значение, а не желаемое.
    assert control["value"] == 0

    with platform_scope():
        entry = (
            AuditLog.all_objects.using("platform")
            .filter(action="grms.command")
            .order_by("-created_at")
            .first()
        )
    assert entry.payload["result"] == commands.RESULT_UNCONFIRMED


def test_value_out_of_range_is_refused_by_the_server(guest):
    """`26` для скорости 0–3 отбивается здесь, а не доезжает до Modbus."""
    response = guest.post(
        "/api/v1/guest/room/command",
        {"controlId": "ac.1", "capability": "fan_speed", "value": 26},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "value_out_of_range"


def test_current_temperature_accepts_no_commands(guest):
    """Единственная read-only ручка каталога."""
    response = guest.post(
        "/api/v1/guest/room/command",
        {"controlId": "ac.1", "capability": "current_temp", "value": 25},
    )
    assert response.status_code == 422
    assert catalog.CAPABILITIES["current_temp"].readonly


# --- Оффлайн ----------------------------------------------------------------


def test_offline_node_hides_every_value_instead_of_showing_stale_ones(guest, crystal):
    """
    КРИТИЧНОЕ. Связи нет — значений нет. Ни старых, ни «последних известных».

    Гость, которому показали «шторы открыты» на мёртвом канале, поверит экрану,
    а не окну.
    """
    fresh = _controls(guest.get("/api/v1/guest/room/state").json())
    assert fresh["light.living"]["value"] is not None, "стенд обязан отвечать до опыта"

    with tenant_context(crystal):
        OnPremNode.objects.all().update(last_seen_at=None)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["availability"] == "unavailable"
    assert payload["zones"] == []
    # Нейтральный текст без технической причины.
    assert "ресепшен" in payload["message"]
    assert "CONNECTOR" not in payload["message"]


def test_command_is_refused_while_the_room_is_unavailable(guest, crystal):
    with tenant_context(crystal):
        OnPremNode.objects.all().update(last_seen_at=None)

    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "room_unavailable"


# --- Доверие, PIN и демо-вход ------------------------------------------------


def test_with_the_demo_flag_off_a_command_without_pin_is_refused(guest, crystal):
    _demo_entry(crystal, False)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["can_command"] is False
    # Смотреть при этом можно: доверие ограничивает действия, а не просмотр.
    assert payload["availability"] == "online"
    assert payload["zones"]

    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "trust_required"


def test_with_the_demo_flag_on_a_command_passes_and_lands_in_the_journal(guest, crystal):
    _demo_entry(crystal, True)

    assert guest.get("/api/v1/guest/room/state").json()["can_command"] is True
    assert (
        guest.post("/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}).status_code
        == 202
    )

    with platform_scope():
        entries = AuditLog.all_objects.using("platform").filter(action="grms.demo_entry")
    assert entries.exists(), "вход без PIN обязан оставить отдельное событие"


def test_the_demo_flag_does_not_open_the_neighbouring_room(client, crystal, stand):
    """
    Послабление касается РОВНО step-up. Комната по-прежнему берётся из сессии,
    и элемента чужого номера в своём просто нет.
    """
    _demo_entry(crystal, True)
    neighbour = GuestClient(client, crystal, _session(client, crystal, room="301"))

    response = neighbour.post(
        "/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}
    )
    # 409: у соседней комнаты нет ни типа, ни опубликованной конфигурации —
    # управлять там нечем, и через этот запрос до 305 не дотянуться.
    assert response.status_code in (403, 409)
    assert response.json()["code"] in ("room_unavailable", "trust_required")


def test_pin_verifies_once_and_survives_the_demo_flag_being_off(guest, crystal):
    _demo_entry(crystal, False)
    assert guest.get("/api/v1/guest/room/state").json()["can_command"] is False

    response = guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN})
    assert response.status_code == 200, response.content

    assert guest.get("/api/v1/guest/room/state").json()["can_command"] is True
    assert (
        guest.post("/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}).status_code
        == 202
    )


def test_wrong_pin_counts_down_and_then_blocks(guest, crystal):
    """Защита от перебора — часть контракта, а не деталь реализации."""
    _demo_entry(crystal, False)

    first = guest.post("/api/v1/guest/room/verify", {"pin": "0000"})
    assert first.status_code == 401
    assert first.json()["code"] == "PIN_INVALID"
    assert first.json()["attempts_left"] >= 1

    last = None
    for _ in range(6):
        last = guest.post("/api/v1/guest/room/verify", {"pin": "0000"})
    assert last.status_code == 429
    assert last.json()["code"] == "PIN_THROTTLED"
    assert last.json()["retry_after_s"] > 0

    # Даже ПРАВИЛЬНЫЙ код в блокировке не проходит — иначе счётчик не защищает.
    assert guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN}).status_code == 429


def test_pin_never_appears_in_the_journal(guest, crystal):
    _demo_entry(crystal, False)
    guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN})

    with platform_scope():
        entries = list(
            AuditLog.all_objects.using("platform").filter(action="grms.pin_attempt")
        )
    assert entries, "попытка обязана попасть в журнал"
    for entry in entries:
        assert DEMO_PIN not in str(entry.payload)


def test_pms_verified_is_left_untouched(guest, crystal):
    """
    Слот `pms_verified` остаётся пустым под НАСТОЯЩУЮ интеграцию PMS.

    Заняв его подтверждением по PIN, мы получили бы систему, где уровень
    «сверено с PMS» больше не значит того, что написано.
    """
    _demo_entry(crystal, False)
    guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN})

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["can_command"] is True
    assert payload["trust"] == "room_scanned", "уровень доверия трогать нельзя"


# --- Изоляция и гейт модуля --------------------------------------------------


def test_unknown_control_id_cannot_reach_another_room(guest):
    response = guest.post(
        "/api/v1/guest/room/command", {"controlId": "light.somebody-elses", "value": 1}
    )
    assert response.status_code == 404
    assert response.json()["code"] == "control_unknown"


def test_module_off_closes_the_route_on_the_server(guest, crystal):
    """Не «пункт скрыт на клиенте», а маршрут закрыт."""
    with tenant_context(crystal):
        HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL).update(is_enabled=False)

    assert guest.get("/api/v1/guest/room/state").status_code == 403
    assert (
        guest.post("/api/v1/guest/room/command", {"controlId": "light.living", "value": 1}).status_code
        == 403
    )
    assert guest.post("/api/v1/guest/room/verify", {"pin": DEMO_PIN}).status_code == 403


def test_hotel_without_the_module_gets_no_flag(client, aurora):
    """Второй отель модуля не имеет — и гость об этом узнаёт узким флагом."""
    token = _session(client, aurora, room="201")
    response = client.get(
        "/api/v1/guest/session",
        HTTP_HOST=host_for(aurora),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    hotel = response.json()["hotel"]
    assert hotel["room_control_enabled"] is False
    # И никакого списка модулей: платный обвес отеля гостя не касается.
    assert "modules" not in hotel


def _room_id(hotel):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return Room.objects.get(number=DEMO_ROOM).pk


def test_a_stand_where_every_channel_answers_false_is_unavailable(guest, monkeypatch):
    """
    ⛔ Картина боевого стенда: обмен с GRMS не поднят, и ВСЕ теги отдают
    булев `false` (прозвон §7).

    После приведения к числу это неотличимо от честного «всё выключено», и
    показать гостю выключенный свет значило бы соврать. Комната с поголовными
    `false` обязана считаться недоступной.

    На эмуляторе такого не бывает — он отвечает настоящими значениями, — поэтому
    картина воспроизводится подменой ответа адаптера, а не подкруткой стенда.
    """
    from apps.grms import adapter, commands

    def all_false(hotel, *, device, feedbacks, subdevice="", room=""):
        return {
            feedback: adapter.IridiResult(ok=True, value=0, raw="", raw_value=False)
            for feedback in feedbacks
        }

    monkeypatch.setattr(commands, "read_many", all_false)

    payload = guest.get("/api/v1/guest/room/state").json()
    assert payload["availability"] == "unavailable"
    assert payload["zones"] == []
