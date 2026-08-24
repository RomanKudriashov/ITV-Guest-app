"""
Типизированные трекеры (R3).

Проверяем ровно то, ради чего обобщался кухонный трекер: у каждого вида
сервиса свой поток статусов, свои действия и своя раскладка, а поток
выводится из типа сервиса, а не хранится отдельно.

Первый тест здесь — сторож обобщения: доска ресторана обязана остаться той
же, что была до R3. Если он покраснел, значит обобщение сломало существующее
поведение, и чинить надо обобщение.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service
from apps.orders.services.status_flows import ensure_status_flows
from apps.orders.services.tracker_types import TrackerType, tracker_type_for_point

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


# --- Помощники -------------------------------------------------------------


def staff(client, hotel, login: str):
    token = client.post(
        "/api/staff/auth/login",
        data={"email": f"{login}@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["access"]

    def call(path, method="get", body=None):
        kwargs = {
            "HTTP_HOST": host_for(hotel),
            "HTTP_AUTHORIZATION": f"Bearer {token}",
        }
        if method == "post":
            return client.post(path, data=body or {}, content_type="application/json", **kwargs)
        return client.get(path, **kwargs)

    return call


def guest_token(client, hotel, room="305"):
    return client.post(
        "/api/guest/session",
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["token"]


def place_request(client, hotel, item_code: str, field_values: dict, key: str):
    """Заявка-услуга гостевым потоком — так же, как её создаёт витрина."""
    token = guest_token(client, hotel)
    kwargs = {"HTTP_HOST": host_for(hotel), "HTTP_AUTHORIZATION": f"Bearer {token}"}

    catalog = client.get("/api/guest/catalog?type=service_request", **kwargs).json()
    item = next(
        entry
        for category in catalog["categories"]
        for entry in category["items"]
        if entry["code"] == item_code
    )
    response = client.post(
        "/api/guest/order",
        data={
            "lines": [{"item_id": item["id"], "quantity": 1}],
            "timing": "asap",
            "field_values": field_values,
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY=key,
        **kwargs,
    )
    assert response.status_code == 201, response.content
    return response.json()["id"]


def codes(board) -> list[str]:
    return [column["code"] for column in board["columns"]]


# --- Сторож обобщения ------------------------------------------------------


def test_restaurant_board_is_unchanged_by_generalisation(client, crystal):
    """
    Кухня после R3 — та же доска с теми же колонками, что и до него.

    Это не «ещё один тест доски», а условие, при котором обобщение вообще
    имело право состояться.
    """
    kitchen = staff(client, crystal, "chef")
    board = kitchen("/api/tracker/orders?point=kitchen").json()

    assert board["tracker_type"] == "board"
    assert board["layout"] == "columns"
    assert codes(board) == ["new", "accepted", "preparing", "on_the_way"]


# --- Тип трекера выводится из типа сервиса ---------------------------------


@pytest.mark.parametrize(
    "point_code, expected",
    [
        ("kitchen", TrackerType.BOARD),
        ("bar", TrackerType.BOARD),
        ("housekeeping", TrackerType.QUEUE),
        ("spa", TrackerType.SCHEDULE),
        ("concierge", TrackerType.REQUESTS),
    ],
)
def test_tracker_type_follows_service_type(crystal, point_code, expected):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code=point_code)
        assert tracker_type_for_point(point) == expected


def test_tracker_type_moves_with_the_service(crystal):
    """
    Тип не хранится у точки: переназначили сервис — трекер сменил вид сам.
    Два источника правды разошлись бы на первом же переименовании.
    """
    with tenant_context(crystal):
        point = ExecutionPoint.objects.get(code="concierge")
        assert tracker_type_for_point(point) == TrackerType.REQUESTS

        service = Service.objects.get(execution_point=point)
        service.type = Service.Type.HOUSEKEEPING
        service.save(update_fields=["type"])

        point.refresh_from_db()
        assert tracker_type_for_point(point) == TrackerType.QUEUE


# --- Очередь хозслужбы: взять / отметить готово ----------------------------


def test_housekeeping_queue_take_and_finish(client, crystal, django_capture_on_commit_callbacks):
    order_id = place_request(
        client, crystal, "cleaning", {"when": "12:00"}, key="hk-queue"
    )
    maid = staff(client, crystal, "maid")

    board = maid("/api/tracker/orders?point=housekeeping").json()
    assert board["tracker_type"] == "queue"
    # Очередь короче доски: у горничной нет «в пути» и «готовится».
    assert codes(board) == ["new", "in_progress"]

    card = board["columns"][0]["orders"][0]
    assert card["id"] == order_id
    assert [status["code"] for status in card["next_statuses"]] == ["in_progress", "done"]

    # «Взять на себя» — то же действие accept, что у кухни, но ведёт в «В работе».
    with django_capture_on_commit_callbacks(execute=True):
        taken = maid(f"/api/tracker/order/{order_id}/accept", "post")
    assert taken.status_code == 200
    assert taken.json()["status"]["code"] == "in_progress"
    assert taken.json()["assignee"]["name"] == "Мария, горничная"

    with django_capture_on_commit_callbacks(execute=True):
        done = maid(f"/api/tracker/order/{order_id}/status", "post", {"status": "done"})
    assert done.status_code == 200
    assert done.json()["status"]["is_terminal"] is True


# --- Заявки консьержа: подтвердить / выполнено -----------------------------


def test_concierge_requests_confirm_and_fulfil(
    client, crystal, django_capture_on_commit_callbacks
):
    order_id = place_request(
        client, crystal, "taxi",
        {"destination": "Аэропорт Пулково", "when": "18:30", "passengers": 2},
        key="cx-requests",
    )
    concierge = staff(client, crystal, "concierge")

    board = concierge("/api/tracker/orders?point=concierge").json()
    assert board["tracker_type"] == "requests"
    # ЗАЯВКИ — ОДНОЙ ЛЕНТОЙ. Раньше здесь было две колонки на два статуса, и
    # они делили экран пополам, стоя полупустыми. Поток статусов при этом не
    # изменился — по нему заявка и едет ниже в этом же тесте.
    assert codes(board) == ["all"]
    assert [status["code"] for status in board["columns"][0]["orders"][0]["next_statuses"]] == [
        "confirmed",
        "fulfilled",
    ]

    with django_capture_on_commit_callbacks(execute=True):
        confirmed = concierge(
            f"/api/tracker/order/{order_id}/status", "post", {"status": "confirmed"}
        )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"]["code"] == "confirmed"

    with django_capture_on_commit_callbacks(execute=True):
        fulfilled = concierge(
            f"/api/tracker/order/{order_id}/status", "post", {"status": "fulfilled"}
        )
    assert fulfilled.json()["status"]["is_terminal"] is True


# --- Потоки не пересекаются ------------------------------------------------


def test_status_codes_are_scoped_to_the_flow(client, crystal):
    """
    `done` есть и у доски, и у очереди — это разные строки. Заказ обязан
    двигаться только по своему потоку, иначе он уедет в чужой и не вернётся.
    """
    order_id = place_request(client, crystal, "cleaning", {"when": "10:00"}, key="hk-stray")
    maid = staff(client, crystal, "maid")

    stray = maid(f"/api/tracker/order/{order_id}/status", "post", {"status": "on_the_way"})
    assert stray.status_code == 422
    assert stray.json()["code"] == "invalid_transition"


def test_every_flow_has_an_initial_and_a_cancel_status(crystal):
    """Без начального статуса поток не примет заказ, без отмены — не отпустит."""
    from apps.orders.services.status_flows import STATUS_FLOWS, cancelled_status, initial_status

    with tenant_context(crystal):
        for flow in STATUS_FLOWS:
            assert initial_status(flow) is not None, flow
            assert cancelled_status(flow) is not None, flow


def test_ensure_status_flows_is_idempotent(crystal):
    from apps.orders.models import StatusDefinition

    with tenant_context(crystal):
        before = StatusDefinition.objects.count()
        ensure_status_flows()
        ensure_status_flows()
        assert StatusDefinition.objects.count() == before


# --- Вид гостевой карточки --------------------------------------------------


def test_guest_card_covers_every_service_type():
    """
    КАЖДЫЙ тип сервиса назван в обеих картах реестра.

    Карточка гостя и трекер персонала читают один вход — тип сервиса. Пропуск в
    одной из карт означает, что новый сервис молча падает в умолчание: гость
    увидит заявку там, где на самом деле запись, и заметит это не он, а мы —
    через неделю после запуска.
    """
    from apps.hotels.models import Service
    from apps.orders.services.tracker_types import SERVICE_TYPE_TO_GUEST_CARD, SERVICE_TYPE_TO_TRACKER

    declared = {value for value, _ in Service.Type.choices}
    assert declared == set(SERVICE_TYPE_TO_TRACKER), "тип сервиса без трекера"
    assert declared == set(SERVICE_TYPE_TO_GUEST_CARD), "тип сервиса без гостевой карточки"


def test_guest_card_of_a_booking_is_a_booking_whatever_the_service():
    """
    Слот делает карточку записью независимо от сервиса.

    Это свойство ЗАКАЗА, а не сервиса: у брони есть назначенное время, и
    «как можно скорее» рядом с ним — прямое враньё. Ровно это и показывала
    универсальная карточка на записи в спа.
    """
    from apps.orders.services.tracker_types import GuestCard, guest_card_for_service_type

    assert guest_card_for_service_type("spa") == GuestCard.BOOKING
    assert guest_card_for_service_type("transfer") == GuestCard.RIDE
    assert guest_card_for_service_type("housekeeping") == GuestCard.REQUEST
    assert guest_card_for_service_type("restaurant") == GuestCard.DELIVERY
