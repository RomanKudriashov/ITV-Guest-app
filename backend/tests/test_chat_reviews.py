"""
Гостевой контур: главная из данных, чат, отзывы.

Ключевые проверки: чат гость↔персонал (создание треда, обе стороны, изоляция),
отзыв приватный и один на заявку, низкая оценка уведомляет менеджера.
"""

from __future__ import annotations

import pytest

from apps.chat.models import ChatMessage, ChatThread
from apps.core.context import tenant_context
from apps.reviews.models import Review

from .conftest import host_for

pytestmark = pytest.mark.django_db


class Guest:
    def __init__(self, client, hotel, token):
        self.client, self.hotel, self.token = client, hotel, token

    def get(self, path, **extra):
        return self.client.get(
            path, HTTP_HOST=host_for(self.hotel), HTTP_AUTHORIZATION=f"Bearer {self.token}", **extra
        )

    def post(self, path, data=None, **extra):
        return self.client.post(
            path, data=data or {}, content_type="application/json",
            HTTP_HOST=host_for(self.hotel), HTTP_AUTHORIZATION=f"Bearer {self.token}", **extra,
        )


def guest_for(client, hotel, room="305"):
    token = client.post(
        "/api/guest/session",
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["token"]
    return Guest(client, hotel, token)


@pytest.fixture
def guest(client, crystal):
    # Комната 212 без сид-чата: сид наполняет тред 305, а этим тестам нужен
    # чистый старт.
    return guest_for(client, crystal, room="212")


def staff_call(client, hotel, login="concierge"):
    token = client.post(
        "/api/staff/auth/login",
        data={"email": f"{login}@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    ).json()["access"]

    def call(path, method="get", data=None):
        kw = {"HTTP_HOST": host_for(hotel), "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if method == "get":
            return client.get(path, **kw)
        return client.post(path, data=data or {}, content_type="application/json", **kw)

    return call


# --- Главная ---------------------------------------------------------------


def test_home_is_built_from_data(guest):
    body = guest.get("/api/guest/home").json()
    tiles = body["tiles"]
    venue_keys = {t["key"] for t in tiles if t["type"] == "venue"}
    # Заведения-точки с наполненным каталогом стали плитками: ресторан (kitchen),
    # спа (slot), консьерж/хозслужба (услуги).
    assert "kitchen" in venue_keys
    assert "spa" in venue_keys
    # Инфо отеля наполнено сидом — плитка инфо присутствует.
    assert any(t["type"] == "info" for t in tiles)
    for tile in tiles:
        assert tile["type"] in {"venue", "service-category", "info", "room-control"}
    for venue in (t for t in tiles if t["type"] == "venue"):
        assert venue["route"] == f"/venue/{venue['key']}"


def test_home_hides_empty_info(guest, crystal):
    """Инфо-плитка появляется только при наличии активных инфо-категорий."""
    with tenant_context(crystal):
        from apps.catalog.models import Category

        Category.objects.filter(type="info").update(is_active=False)

    body = guest.get("/api/guest/home").json()
    assert "info" not in {t["type"] for t in body["tiles"]}


# --- Чат -------------------------------------------------------------------


def test_guest_first_message_creates_thread(guest, crystal):
    empty = guest.get("/api/guest/chat").json()
    assert empty["messages"] == []

    sent = guest.post("/api/guest/chat", {"body": "Когда завтрак?"}).json()
    assert len(sent["messages"]) == 1
    assert sent["messages"][0]["author_type"] == "guest"
    assert sent["messages"][0]["mine"] is True

    with tenant_context(crystal):
        assert ChatThread.objects.filter(room__number="305").count() == 1


def test_staff_sees_and_answers_thread(client, crystal, guest):
    guest.post("/api/guest/chat", {"body": "Нужны полотенца"})

    concierge = staff_call(client, crystal)
    threads = concierge("/api/tracker/chat/threads").json()
    mine = next(t for t in threads if t["room"] == "212")
    assert mine["unread"] == 1

    thread_id = mine["thread_id"]
    answered = concierge(
        f"/api/tracker/chat/threads/{thread_id}", "post", {"body": "Сейчас принесём"}
    ).json()
    # Для персонала своё сообщение — mine, гостевое — нет.
    staff_msg = next(m for m in answered["messages"] if m["author_type"] == "staff")
    assert staff_msg["mine"] is True

    # Гость видит ответ, и для него mine наоборот.
    guest_view = guest.get("/api/guest/chat").json()
    assert any(m["body"] == "Сейчас принесём" and m["mine"] is False for m in guest_view["messages"])


def test_read_markers(client, crystal, guest):
    guest.post("/api/guest/chat", {"body": "первое"})
    concierge = staff_call(client, crystal)
    thread_id = next(
        t["thread_id"] for t in concierge("/api/tracker/chat/threads").json() if t["room"] == "212"
    )

    # Персонал прочитал — счётчик непрочитанных обнулился.
    concierge(f"/api/tracker/chat/threads/{thread_id}/read", "post", {})
    after = next(
        t for t in concierge("/api/tracker/chat/threads").json() if t["room"] == "212"
    )
    assert after["unread"] == 0


def test_empty_message_is_refused(guest):
    response = guest.post("/api/guest/chat", {"body": "   "})
    assert response.status_code == 422


def test_thread_is_isolated_between_guests(client, crystal, guest):
    """Гость B не видит тред гостя A."""
    guest.post("/api/guest/chat", {"body": "секрет комнаты 305"})

    other = guest_for(client, crystal, room="201")
    other.post("/api/guest/chat", {"body": "комната 201"})

    a_view = guest.get("/api/guest/chat").json()
    b_view = other.get("/api/guest/chat").json()
    assert a_view["thread_id"] != b_view["thread_id"]
    assert "секрет" not in " ".join(m["body"] for m in b_view["messages"])


def test_threads_are_isolated_between_hotels(client, crystal, aurora, guest):
    guest.post("/api/guest/chat", {"body": "тред-кристалла-секрет"})
    # Aurora имеет свои сид-треды, но треда Crystal среди них быть не может.
    aurora_staff = staff_call(client, aurora)
    bodies = " ".join(t["last_body"] for t in aurora_staff("/api/tracker/chat/threads").json())
    assert "кристалла-секрет" not in bodies


def test_guest_cannot_reach_staff_chat(client, crystal, guest):
    response = client.get(
        "/api/tracker/chat/threads",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest.token}",
    )
    assert response.status_code == 401


# --- Отзывы ----------------------------------------------------------------


def _finished_order(client, crystal, guest, key="rev-1"):
    """Оформляет и завершает заказ, возвращает его id."""
    menu = guest.get("/api/guest/menu").json()
    item_id = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    order_id = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY=key,
    ).json()["id"]

    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        change_status(get_order(order_id), to_code="done", actor_type="staff")
    return order_id


def test_review_can_be_left_after_completion(client, crystal, guest):
    order_id = _finished_order(client, crystal, guest)

    order = guest.get(f"/api/guest/order/{order_id}").json()
    assert order["can_review"] is True

    response = guest.post(
        f"/api/guest/order/{order_id}/review", {"rating": 5, "comment": "Отлично"}
    )
    assert response.status_code == 201, response.content

    # Теперь заказ уже не предлагает оценить, а несёт сам отзыв.
    after = guest.get(f"/api/guest/order/{order_id}").json()
    assert after["can_review"] is False
    assert after["review"]["rating"] == 5


def test_review_before_completion_is_refused(client, crystal, guest):
    menu = guest.get("/api/guest/menu").json()
    item_id = next(i["id"] for c in menu["categories"] for i in c["items"] if i["code"] == "caesar")
    order_id = guest.post(
        "/api/guest/order",
        {"lines": [{"item_id": item_id, "quantity": 1}], "timing": "asap"},
        HTTP_IDEMPOTENCY_KEY="rev-early",
    ).json()["id"]

    response = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 4})
    assert response.status_code == 422
    assert response.json()["code"] == "review_not_allowed"


def test_one_review_per_order(client, crystal, guest):
    order_id = _finished_order(client, crystal, guest, key="rev-dup")
    guest.post(f"/api/guest/order/{order_id}/review", {"rating": 5})

    second = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 1})
    assert second.status_code == 409
    assert second.json()["code"] == "review_exists"


def test_review_is_private_visible_to_staff_only(client, crystal, guest):
    order_id = _finished_order(client, crystal, guest, key="rev-priv")
    guest.post(f"/api/guest/order/{order_id}/review", {"rating": 5, "comment": "супер"})

    # Персонал видит.
    chef = staff_call(client, crystal, "chef")
    reviews = chef("/api/cms/reviews").json()
    assert any(r["comment"] == "супер" for r in reviews)

    # Другой гость — нет: у отзыва нет публичного эндпоинта, а чужой заказ 404.
    other = guest_for(client, crystal, room="201")
    assert other.get(f"/api/guest/order/{order_id}/review").status_code == 404


def test_low_rating_notifies_the_manager(
    client, crystal, guest, settings, django_capture_on_commit_callbacks
):
    """Низкая оценка → событие review.low после коммита → уведомление менеджеру."""
    settings.NOTIFICATIONS_ENABLED = True
    order_id = _finished_order(client, crystal, guest, key="rev-low")

    from apps.events import bus

    captured = []
    unsubscribe = bus.subscribe(bus.REVIEW_LOW)(lambda e: captured.append(e.name))

    with django_capture_on_commit_callbacks(execute=True):
        response = guest.post(
            f"/api/guest/order/{order_id}/review", {"rating": 2, "comment": "холодно"}
        )

    bus._subscribers[bus.REVIEW_LOW].remove(unsubscribe)
    assert response.status_code == 201
    assert bus.REVIEW_LOW in captured


def test_high_rating_does_not_notify(client, crystal, guest, django_capture_on_commit_callbacks):
    order_id = _finished_order(client, crystal, guest, key="rev-high")

    from apps.events import bus

    captured = []
    handler = bus.subscribe(bus.REVIEW_LOW)(lambda e: captured.append(e.name))
    with django_capture_on_commit_callbacks(execute=True):
        guest.post(f"/api/guest/order/{order_id}/review", {"rating": 5})
    bus._subscribers[bus.REVIEW_LOW].remove(handler)

    assert bus.REVIEW_LOW not in captured


def test_review_settings_roundtrip(cms):
    cms.patch("/api/cms/review-settings", {"enabled": False})
    assert cms.get("/api/cms/review-settings").json()["enabled"] is False
    cms.patch("/api/cms/review-settings", {"enabled": True, "low_rating_threshold": 2})
    settings = cms.get("/api/cms/review-settings").json()
    assert settings["low_rating_threshold"] == 2


def test_disabled_reviews_block_can_review(client, crystal, guest, cms):
    cms.patch("/api/cms/review-settings", {"enabled": False})
    order_id = _finished_order(client, crystal, guest, key="rev-disabled")
    assert guest.get(f"/api/guest/order/{order_id}").json()["can_review"] is False
