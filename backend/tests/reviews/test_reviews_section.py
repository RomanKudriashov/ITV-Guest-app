"""
Раздел «Отзывы» в CMS: кто что видит, фильтры, динамика и ответ гостю.

Главное правило одно на список, фильтр и динамику: отзыв о заказе из двух
заведений принадлежит каждой части.
"""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.accounts.models import GuestSession
from apps.chat.models import ChatMessage
from apps.core.context import tenant_context
from apps.orders.models import Order
from apps.reviews.models import Review
from tests.chat.api.test_chat_reviews import _finished_order, guest_for, staff_call
from tests.conftest import CmsClient, staff_token_for
from tests.orders.api.test_guest_service_cart import aggregator, dish_id  # noqa: F401
from tests.orders.api.test_guest_service_cart import guest as cart_guest

pytestmark = pytest.mark.django_db


def _as(client, crystal, login) -> CmsClient:
    return CmsClient(client, crystal, staff_token_for(client, crystal, login))


@pytest.fixture
def guest(client, crystal):
    return guest_for(client, crystal, room="212")


@pytest.fixture
def two_venue_review(client, crystal, aggregator):  # noqa: F811
    """Отзыв «1» на заказ кухни и бара; возвращает id отзыва."""
    call = cart_guest(client, crystal)
    order_id = call(
        "/api/guest/order",
        "post",
        {
            "service_code": "room_service",
            "lines": [
                {"item_id": dish_id(call, aggregator["dish_code"]), "quantity": 1},
                {"item_id": aggregator["cocktail"], "quantity": 1},
            ],
            "timing": "asap",
        },
        HTTP_IDEMPOTENCY_KEY="section-parts",
    ).json()["id"]
    with tenant_context(crystal):
        from apps.orders.services import change_status, get_order

        for child in Order.objects.get(pk=order_id).children.all():
            change_status(get_order(child.pk), to_code="done", actor_type="staff")
    response = call(f"/api/guest/order/{order_id}/review", "post", {"rating": 1, "comment": "две части"})
    assert response.status_code == 201, response.content
    return response.json()["id"]


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.content
    return {item["id"] for item in response.json()["items"]}


# --- Кто видит ------------------------------------------------------------------


def test_each_part_manager_sees_a_two_venue_review_and_others_do_not(client, crystal, two_venue_review):
    assert two_venue_review in _ids(_as(client, crystal, "manager.restaurant").get("/api/cms/reviews"))
    assert two_venue_review in _ids(_as(client, crystal, "manager.bar").get("/api/cms/reviews"))
    assert two_venue_review not in _ids(_as(client, crystal, "manager.spa").get("/api/cms/reviews"))


def test_line_staff_does_not_see_the_section(client, crystal):
    assert staff_call(client, crystal, "chef")("/api/cms/reviews").status_code == 403


def test_the_card_names_every_part(client, crystal, cms, two_venue_review):
    item = next(i for i in cms.get("/api/cms/reviews").json()["items"] if i["id"] == two_venue_review)
    assert len(item["points"]) == 2
    assert item["is_low"] is True


# --- Фильтры ---------------------------------------------------------------------


def test_filters_by_venue_rating_and_dates(client, crystal, cms, guest, two_venue_review):
    five = guest.post(
        f"/api/guest/order/{_finished_order(client, crystal, guest, key='section-5')}/review",
        {"rating": 5},
    ).json()["id"]
    with tenant_context(crystal):
        from apps.hotels.models import ExecutionPoint

        bar = str(ExecutionPoint.objects.get(code="bar").pk)

    assert _ids(cms.get(f"/api/cms/reviews?point_id={bar}")) == {two_venue_review}
    assert _ids(cms.get("/api/cms/reviews?rating=1,2")) >= {two_venue_review}
    assert five not in _ids(cms.get("/api/cms/reviews?rating=1,2"))
    assert two_venue_review in _ids(cms.get("/api/cms/reviews?rating=low"))
    assert five not in _ids(cms.get("/api/cms/reviews?rating=low"))

    today = timezone.now().astimezone(crystal.tzinfo).date().isoformat()
    assert {two_venue_review, five} <= _ids(cms.get(f"/api/cms/reviews?date_from={today}&date_to={today}"))
    assert not _ids(cms.get("/api/cms/reviews?date_to=2020-01-01"))
    wrong = cms.get("/api/cms/reviews?date_from=2026-02-02&date_to=2026-02-01")
    assert wrong.status_code == 422 and wrong.json()["code"] == "bad_range"


def test_pages_have_an_honest_total(client, crystal, cms, guest):
    for key in ("page-1", "page-2", "page-3"):
        guest.post(f"/api/guest/order/{_finished_order(client, crystal, guest, key=key)}/review", {"rating": 4})
    total = cms.get("/api/cms/reviews").json()["total"]
    first = cms.get("/api/cms/reviews?limit=2").json()
    assert len(first["items"]) == 2 and first["total"] == total and first["truncated"]
    rest = cms.get("/api/cms/reviews?limit=2&offset=2").json()
    assert not ({i["id"] for i in first["items"]} & {i["id"] for i in rest["items"]})


def test_the_summary_uses_the_same_selection(client, crystal, two_venue_review):
    with tenant_context(crystal):
        from apps.hotels.models import ExecutionPoint

        bar = str(ExecutionPoint.objects.get(code="bar").pk)
    summary = _as(client, crystal, "manager.bar").get(f"/api/cms/reviews/summary?point_id={bar}").json()
    assert summary["count"] == 1, "отзыв о двух частях учтён и в динамике бара"
    assert summary["avg_rating"] == 1
    assert summary["low"] == 1 and summary["low_threshold"] == 2
    assert [day["count"] for day in summary["trend"]] == [1]


# --- Ответ гостю ----------------------------------------------------------------


def test_a_reply_reaches_a_guest_who_is_still_here(client, crystal, cms, guest):
    order_id = _finished_order(client, crystal, guest, key="reply-live")
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 2}).json()["id"]

    listed = next(i for i in cms.get("/api/cms/reviews").json()["items"] if i["id"] == review_id)
    assert listed["guest_reachable"] is True and listed["reply"] is None

    response = cms.post(f"/api/cms/reviews/{review_id}/reply", {"text": "Простите, исправим"})
    assert response.status_code == 200, response.content
    reply = response.json()["reply"]
    assert reply["delivered"] is True and reply["text"] == "Простите, исправим" and reply["by"]

    chat = guest.get("/api/guest/chat").json()
    assert any(m["body"] == "Простите, исправим" and m["author_type"] == "staff" for m in chat["messages"])
    assert guest.get(f"/api/guest/order/{order_id}/review").json()["reply"]["text"] == "Простите, исправим"

    again = cms.post(f"/api/cms/reviews/{review_id}/reply", {"text": "ещё"})
    assert again.status_code == 409 and again.json()["code"] == "reply_exists"


def test_a_reply_to_a_guest_who_left_is_only_kept(client, crystal, cms, guest):
    order_id = _finished_order(client, crystal, guest, key="reply-gone")
    review_id = guest.post(f"/api/guest/order/{order_id}/review", {"rating": 1}).json()["id"]
    with tenant_context(crystal):
        session_id = Review.objects.get(pk=review_id).guest_session_id
        GuestSession.objects.filter(pk=session_id).update(revoked_at=timezone.now())
        before = ChatMessage.objects.count()

    listed = next(i for i in cms.get("/api/cms/reviews").json()["items"] if i["id"] == review_id)
    assert listed["guest_reachable"] is False, "экран предупреждает ДО ответа"

    reply = cms.post(f"/api/cms/reviews/{review_id}/reply", {"text": "Жаль"}).json()["reply"]
    assert reply["delivered"] is False
    with tenant_context(crystal):
        assert ChatMessage.objects.count() == before, "в пустоту не пишем"
        assert Review.objects.get(pk=review_id).reply_text == "Жаль"


def test_a_manager_cannot_reply_to_someone_elses_review(client, crystal, two_venue_review):
    spa = _as(client, crystal, "manager.spa")
    assert spa.post(f"/api/cms/reviews/{two_venue_review}/reply", {"text": "не моё"}).status_code == 404


def test_an_empty_reply_is_refused(client, crystal, cms, two_venue_review):
    assert cms.post(f"/api/cms/reviews/{two_venue_review}/reply", {"text": "  "}).status_code == 422
