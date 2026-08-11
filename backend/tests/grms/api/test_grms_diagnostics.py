"""
Диагностика инженера: журнал обмена и состояние связи (ТЗ §14.3, §6.8).

Проверяется ровно то, за что требование и написано:

* инженер видит ЗАПИСАННОЕ — все восемь полей §14.3, включая элемент интерфейса;
* причины отказа §6.8 РАЗЛИЧАЮТСЯ и названы, а не схлопнуты в «не получилось»;
* три звена связи показаны ПОРОЗНЬ, а не одной строкой «недоступно»;
* фильтры работают и комбинируются;
* чужой отель недостижим, гостевой токен не пускают.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.grms.transport import adapter
from apps.hotels.models import HotelModule

from tests.conftest import host_for

pytestmark = pytest.mark.django_db

DIAG = "/api/v1/cms/grms/diagnostics"


def _enable_module(hotel, enabled: bool = True):
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL,
            defaults={"is_enabled": enabled, "source": HotelModule.Source.TARIFF},
        )


def _entry(hotel, *, action="grms.command", room="305", element="ac.1", result="confirmed", **extra):
    """Строка журнала того же вида, что пишет services/commands.py."""
    payload = {
        "room": room,
        "element": element,
        "requestID": "ce3ba8ef-a30b-4812-97c6-37e90ccb4d1c",
        "device": "Modbus TCP Server (Slave mode) 305",
        "command": "C_Light 1",
        "feedback": "F_Light 1",
        "sent": 1,
        "raw_response": '{"status":"true","value":"1"}',
        "duration_ms": 42,
        "result": result,
        **extra,
    }
    with tenant_context(hotel):
        return AuditLog.record(
            action,
            actor_type=AuditLog.ActorType.SYSTEM,
            object_type="grms.channel",
            payload=payload,
            hotel_id=hotel.pk,
        )


# --- Что видит инженер ------------------------------------------------------


def test_journal_shows_every_field_the_spec_promises(cms, crystal):
    """
    Восемь полей ТЗ §14.3 — комната, элемент, устройство, command и feedback,
    отправленное значение, ответ, длительность, итоговый статус.
    """
    _enable_module(crystal)
    _entry(crystal)

    response = cms.get(DIAG)
    assert response.status_code == 200, response.content
    row = response.json()["rows"][0]

    assert row["room"] == "305"
    assert row["element"] == "ac.1"
    assert row["device"] == "Modbus TCP Server (Slave mode) 305"
    assert row["command"] == "C_Light 1"
    assert row["feedback"] == "F_Light 1"
    assert row["sent"] == 1
    assert row["raw_response"] == '{"status":"true","value":"1"}'
    assert row["duration_ms"] == 42
    assert row["result"] == "confirmed"
    # Время самой записи и requestID — чтобы сверить с журналом коннектора.
    assert row["at"]
    assert row["request_id"] == "ce3ba8ef-a30b-4812-97c6-37e90ccb4d1c"
    # Успех причины не имеет: пустое поле, а не выдуманное «ок».
    assert row["reason"] == ""


@pytest.mark.parametrize(
    "code,label",
    [
        (adapter.CONNECTOR_OFFLINE, "коннектор не подключён"),
        (adapter.ENDPOINT_UNREACHABLE, "endpoint iRidi недоступен"),
        (adapter.BAD_RESPONSE, "iRidi вернул некорректный ответ"),
        (adapter.TIMEOUT, "превышен тайм-аут"),
        (adapter.DEVICE_OR_CHANNEL_NOT_FOUND, "устройство или канал не найдены"),
    ],
)
def test_five_causes_of_failure_are_told_apart(cms, crystal, code, label):
    """
    ТЗ §6.8 перечисляет ПЯТЬ причин поимённо. Инженер должен видеть, какая
    именно, — «не получилось» одной строкой это и есть то расхождение, ради
    которого требование написано.
    """
    _enable_module(crystal)
    _entry(crystal, result="failed", transport_error=code)

    row = cms.get(DIAG).json()["rows"][0]
    assert row["reason"] == code
    assert row["reason_label"] == label
    assert row["result"] == "failed"


def test_transport_failure_outranks_the_application_one(cms, crystal):
    """
    Не доехали до iRidi — значит его ответа не существует. Показать «некорректный
    ответ» поверх «коннектор не подключён» значит послать инженера не туда.
    """
    _enable_module(crystal)
    _entry(
        crystal,
        result=adapter.BAD_RESPONSE,
        transport_error=adapter.CONNECTOR_OFFLINE,
    )

    row = cms.get(DIAG).json()["rows"][0]
    assert row["reason"] == adapter.CONNECTOR_OFFLINE


def test_real_command_path_records_the_interface_element(crystal):
    """
    Элемент интерфейса пишется НАСТОЯЩИМ путём, а не только в фикстуре.

    Коннектора в этом тесте нет, поэтому чтение честно отбивается
    CONNECTOR_OFFLINE — и заодно показывает, что причина §6.8 доезжает до
    журнала сама, без подсказок.
    """
    from apps.grms.services import commands

    commands.read(crystal, device="Modbus 305", feedback="F_Light 1", room="305", element="ac.1")

    with tenant_context(crystal):
        entry = AuditLog.objects.filter(action="grms.read").order_by("-created_at").first()
    assert entry is not None
    assert entry.payload["element"] == "ac.1"
    assert entry.payload["transport_error"] == adapter.CONNECTOR_OFFLINE


# --- Фильтры ----------------------------------------------------------------


def test_filters_narrow_the_list_and_combine(cms, crystal):
    _enable_module(crystal)
    _entry(crystal, room="305", result="confirmed")
    _entry(crystal, room="410", result="failed", transport_error=adapter.TIMEOUT)
    _entry(crystal, room="410", result="confirmed")

    rooms = [row["room"] for row in cms.get(f"{DIAG}?room=410").json()["rows"]]
    assert rooms == ["410", "410"]

    failed = cms.get(f"{DIAG}?outcome=failed").json()["rows"]
    assert len(failed) == 1
    assert failed[0]["room"] == "410"

    # Комбинируются (AND), а не заменяют друг друга.
    both = cms.get(f"{DIAG}?room=305&outcome=failed").json()["rows"]
    assert both == []


def test_filter_by_element_kind_uses_the_catalog_not_the_slug(cms, crystal):
    """
    Вид элемента берётся из конфигурации: `ac.1` — идентификатор, и разбирать
    его строкой модель запрещает прямо.
    """
    from apps.grms.models import ControlElement, RoomType, Zone

    _enable_module(crystal)
    with tenant_context(crystal):
        room_type = RoomType.objects.create(hotel=crystal, code="std")
        zone = Zone.objects.create(hotel=crystal, room_type=room_type, code="living", title={"ru": "Комната"})
        ControlElement.objects.create(
            hotel=crystal, room_type=room_type, zone=zone, slug="ac.1", kind="air_conditioner"
        )
        ControlElement.objects.create(
            hotel=crystal, room_type=room_type, zone=zone, slug="curtain.1", kind="curtain"
        )
    _entry(crystal, element="ac.1")
    _entry(crystal, element="curtain.1")

    rows = cms.get(f"{DIAG}?element_kind=air_conditioner").json()["rows"]
    assert [row["element"] for row in rows] == ["ac.1"]
    assert rows[0]["element_kind"] == "air_conditioner"

    # Вид без элементов — пустая выдача, а не снятый фильтр.
    assert cms.get(f"{DIAG}?element_kind=scene").json()["rows"] == []


def test_time_range_filters_by_hotel_days(cms, crystal):
    _enable_module(crystal)
    old = _entry(crystal, room="111")
    with tenant_context(crystal):
        AuditLog.objects.filter(pk=old.pk).update(
            created_at=old.created_at - timedelta(days=10)
        )
    _entry(crystal, room="222")

    today = crystal.local_now().date().isoformat()
    recent = cms.get(f"{DIAG}?date_from={today}").json()["rows"]
    assert [row["room"] for row in recent] == ["222"]

    older = (crystal.local_now().date() - timedelta(days=30)).isoformat()
    assert len(cms.get(f"{DIAG}?date_from={older}").json()["rows"]) == 2


def test_broken_filters_are_refused_not_ignored(cms, crystal):
    """Мусор в фильтре — отказ. Молча отдать весь журнал значит соврать о выдаче."""
    _enable_module(crystal)

    bad_date = cms.get(f"{DIAG}?date_from=2026-13-45")
    assert bad_date.status_code == 422, bad_date.content
    assert bad_date.json()["code"] == "bad_date"

    bad_outcome = cms.get(f"{DIAG}?outcome=maybe")
    assert bad_outcome.status_code == 422
    assert bad_outcome.json()["code"] == "bad_outcome"

    reversed_range = cms.get(f"{DIAG}?date_from=2026-07-25&date_to=2026-07-20")
    assert reversed_range.status_code == 422
    assert reversed_range.json()["code"] == "bad_range"


def test_long_journal_is_capped_and_says_so(cms, crystal):
    """Обрезанную выдачу видно: инженер обязан знать, что смотрит не всё."""
    _enable_module(crystal)
    for index in range(5):
        _entry(crystal, room=str(300 + index))

    body = cms.get(f"{DIAG}?limit=2").json()
    assert len(body["rows"]) == 2
    assert body["truncated"] is True
    assert body["limit"] == 2

    assert cms.get(f"{DIAG}?limit=50").json()["truncated"] is False


# --- Состояние связи --------------------------------------------------------


def test_link_state_shows_three_links_apart(cms, crystal):
    """
    ТЗ §14: «статусы коннектора и iRidi отображаются отдельно», §6.1 добавляет
    третью проверку — читаются ли состояния. Гостю всё это схлопывается в одну
    фразу; инженеру — нет, иначе он не знает, куда ехать.
    """
    _enable_module(crystal)
    _entry(crystal, action="grms.read", result=adapter.BAD_RESPONSE)

    body = cms.get(f"{DIAG}/link").json()
    assert set(body) >= {"connector", "iridi_endpoint", "state_readable"}

    # Узла отелю не заводили — это не «офлайн», это «не заведён».
    assert body["connector"]["state"] == "unknown"
    # Коннектор молчал — про endpoint он ничего не сообщал.
    assert body["iridi_endpoint"]["state"] == "unknown"
    # Читаемость — по последнему чтению в журнале, с его причиной и временем.
    assert body["state_readable"]["state"] == "unreadable"
    assert body["state_readable"]["reason"] == adapter.BAD_RESPONSE
    assert body["state_readable"]["reason_label"] == "iRidi вернул некорректный ответ"
    assert body["state_readable"]["at"]


def test_link_state_without_any_reading_is_unknown_not_broken(cms, crystal):
    """Ни одного чтения — «неизвестно», а не «сломано»: это разные новости."""
    _enable_module(crystal)
    body = cms.get(f"{DIAG}/link").json()
    assert body["state_readable"]["state"] == "unknown"
    assert body["state_readable"]["at"] is None


def test_filters_endpoint_lists_kinds_from_the_catalog(cms, crystal):
    _enable_module(crystal)
    body = cms.get(f"{DIAG}/filters").json()
    codes = [entry["code"] for entry in body["element_kinds"]]
    assert "air_conditioner" in codes and "curtain" in codes
    assert body["outcomes"] == ["confirmed", "unconfirmed", "accepted", "failed", "ok"]


# --- Границы: чужой отель и гость -------------------------------------------


def test_another_hotel_journal_is_unreachable(cms, crystal, aurora):
    """
    Номера у отелей одинаковые сплошь и рядом: «305» есть у каждого второго.
    Фильтр по номеру не должен становиться дырой между тенантами.
    """
    _enable_module(crystal)
    _enable_module(aurora)
    _entry(crystal, room="305", element="ac.1")
    _entry(aurora, room="305", element="ac.9", device="ЧУЖОЕ УСТРОЙСТВО")

    rows = cms.get(f"{DIAG}?room=305").json()["rows"]
    assert len(rows) == 1
    assert rows[0]["element"] == "ac.1"
    assert all("ЧУЖОЕ" not in row["device"] for row in rows)


def test_guest_token_cannot_reach_diagnostics(client, crystal, guest_token):
    """
    Технические причины гостю не показываются никогда (ТЗ §6.7). Здесь это
    держит не вёрстка, а рубеж: гостевой токен в /api/v1/cms не пускают.
    """
    _enable_module(crystal)
    for path in (DIAG, f"{DIAG}/link", f"{DIAG}/filters"):
        response = client.get(
            path,
            HTTP_HOST=host_for(crystal),
            HTTP_AUTHORIZATION=f"Bearer {guest_token}",
        )
        assert response.status_code in (401, 403), path


def test_module_off_closes_diagnostics(cms, crystal):
    _enable_module(crystal, False)
    for path in (DIAG, f"{DIAG}/link", f"{DIAG}/filters"):
        response = cms.get(path)
        assert response.status_code == 403, path
        assert response.json()["code"] == "module_disabled"


def test_line_staff_cannot_reach_diagnostics(cms_line_staff, crystal):
    """
    Журнал обмена и настройки — не для линейного персонала (R3).

    Повар видит доску трекера, но не настройки отеля и не диагностику: там
    имена устройств, каналы iRidi и сырые ответы железа. Рубеж стоит на входе
    в CMS (`CmsAuth`), а не на экране, поэтому закрыт и сам маршрут.
    """
    _enable_module(crystal)
    for path in (DIAG, f"{DIAG}/link", f"{DIAG}/filters"):
        assert cms_line_staff.get(path).status_code == 403, path
