"""
ВСПЛЫВАЮЩИЕ КАРТОЧКИ (партия 59а): заказ, номер, заведение.

Проверяется:

* бюджет — не больше 4 запросов на карточку, и у администратора, и у
  линейного: наведение мышью по списку — это десятки карточек подряд;
* права — те же, что у экранов: заказ и заведение чужой точки — 403, счёт
  заказов номера — только по своим точкам;
* персональных данных гостя в карточке номера нет ни у кого;
* RLS — id из другого отеля даёт 404, а не чужие данные;
* сторож «новое поле → в карточку»: каждое поле экранного сериализатора типа
  либо показано в карточке, либо исключено с причиной (`CARD_FIELDS`).
"""

from __future__ import annotations

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.context import tenant_context
from apps.hotels.services.cards import CARD_FIELDS
from tests.conftest import CmsClient, host_for, staff_token_for

pytestmark = pytest.mark.django_db

BUDGET = 4


def _staff(client, hotel, login):
    return CmsClient(client, hotel, staff_token_for(client, hotel, login))


def _place_caesar(client, hotel, token, key):
    menu = client.get(
        "/api/v1/guest/catalog?type=product",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    ).json()
    caesar = next(i for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    response = client.post(
        "/api/v1/guest/order",
        data={"lines": [{"item_id": caesar["id"], "quantity": 2}]},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert response.status_code in (200, 201), response.content
    return response.json()


@pytest.fixture
def kitchen_order(client, crystal, guest_token):
    """Заказ кухни из номера 201 — гость с живой сессией в номере."""
    return _place_caesar(client, crystal, guest_token, "card-1")


def _user(hotel, login):
    from apps.accounts.models import User

    with tenant_context(hotel):
        return User.objects.get(email=f"{login}@{hotel.subdomain}.local")


# --- Бюджет -----------------------------------------------------------------


@pytest.mark.parametrize("login", ["owner", "chef"])
def test_every_card_fits_the_query_budget(crystal, kitchen_order, login):
    """
    УКУС. Не больше 4 запросов на карточку — у администратора и у линейного.

    Меряется сам сервис карточки, ВСЕ его запросы без фильтров: аутентификация
    общая для любой ручки, а фильтр «по таблице» однажды выкинул бы из счёта
    запрос самой карточки (заказ джойнит исполнителя из таблицы учёток).
    """
    from apps.hotels.services import cards

    user = _user(crystal, login)
    with tenant_context(crystal):
        for card_type, key in (("order", kitchen_order["id"]), ("room", "201"), ("venue", "kitchen")):
            with CaptureQueriesContext(connection) as queries:
                cards.card(user, card_type, key, "ru")
            count = len(queries.captured_queries)
            assert count <= BUDGET, (card_type, count, [q["sql"][:200] for q in queries.captured_queries])


# --- Права ------------------------------------------------------------------


def test_an_order_of_a_foreign_point_is_closed_to_line_staff(client, crystal, kitchen_order):
    """УКУС. Бармен не видит карточку заказа кухни — как и доску кухни."""
    barman = _staff(client, crystal, "barman")
    assert barman.get(f"/api/v1/cards/order/{kitchen_order['id']}").status_code == 403

    chef = _staff(client, crystal, "chef")
    card = chef.get(f"/api/v1/cards/order/{kitchen_order['id']}").json()
    assert card["number"] == kitchen_order["number"]
    assert card["room"] == "201"
    assert card["rights"]["move"] is True
    assert any(stage["current"] for stage in card["stages"])


def test_a_foreign_venue_is_closed_to_line_staff(client, crystal):
    """УКУС. Чужое заведение — 403 «нет доступа»; своё и любое у админа — 200."""
    barman = _staff(client, crystal, "barman")
    assert barman.get("/api/v1/cards/venue/kitchen").status_code == 403
    assert barman.get("/api/v1/cards/venue/bar").status_code == 200
    assert _staff(client, crystal, "owner").get("/api/v1/cards/venue/kitchen").status_code == 200


def test_room_counts_only_the_viewers_points(client, crystal, kitchen_order):
    """УКУС. Заказ кухни в номере 201 — повар его видит в счёте, бармен нет."""
    chef = _staff(client, crystal, "chef").get("/api/v1/cards/room/201").json()
    barman = _staff(client, crystal, "barman").get("/api/v1/cards/room/201").json()
    assert chef["open_orders"] >= 1
    assert barman["open_orders"] == 0
    assert chef["guest_online"] is True


def test_the_room_card_carries_no_guest_data(client, crystal, kitchen_order):
    """
    УКУС. Ни имени, ни языка, ни истории гостя: только «есть ли сессия».
    Список ключей закрыт — новое поле с данными гостя не проскочит молча.
    """
    card = _staff(client, crystal, "owner").get("/api/v1/cards/room/201").json()
    assert set(card) == {
        "type", "id", "number", "floor", "building", "category", "is_active",
        "out_of_service", "housekeeping", "guest_online", "open_orders",
        "open_tasks", "control",
    }


def test_a_card_from_another_hotel_is_not_found(client, crystal, aurora, kitchen_order):
    """УКУС. RLS: id заказа «Кристалла» в «Авроре» — 404, а не чужая карточка."""
    other = _staff(client, aurora, "owner")
    assert other.get(f"/api/v1/cards/order/{kitchen_order['id']}").status_code == 404


def test_an_unknown_card_type_is_not_found(client, crystal):
    assert _staff(client, crystal, "owner").get("/api/v1/cards/guest/201").status_code == 404


# --- Сторож «новое поле → в карточку» -----------------------------------------


def _serializer_keys(crystal, kitchen_order) -> dict[str, set[str]]:
    from apps.hotels.models import Room, Service
    from apps.hotels.services.admin_services import serialize_room, serialize_service
    from apps.orders.services import tracker

    with tenant_context(crystal):
        order = tracker.order_queryset().select_related("assignee").get(pk=kitchen_order["id"])
        room = Room.objects.select_related("category", "building").get(number="201")
        service = Service.objects.select_related("execution_point", "image").get(code="kitchen")
        return {
            "order": set(tracker.serialize_tracker_order(order)) | {"rights", "assigned_to_me"},
            "room": set(serialize_room(room, hotel=crystal)),
            "venue": set(serialize_service(service)),
        }


def test_every_field_of_the_entity_is_in_its_card_or_excluded_with_a_reason(crystal, kitchen_order):
    """
    СТОРОЖ. Новое поле экранного сериализатора краснит тест, пока его не
    положат в карточку (`shown`) или не исключат с причиной (`excluded`) в
    `apps/hotels/services/cards.py::CARD_FIELDS`.
    """
    missing = {}
    for card_type, keys in _serializer_keys(crystal, kitchen_order).items():
        registry = CARD_FIELDS[card_type]
        known = set(registry["shown"]) | set(registry["excluded"])
        new = sorted(keys - known)
        if new:
            missing[card_type] = new
        for field, reason in registry["excluded"].items():
            assert reason.strip(), f"{card_type}.{field}: исключение без причины"
    assert not missing, f"поля не учтены в карточке (CARD_FIELDS): {missing}"
