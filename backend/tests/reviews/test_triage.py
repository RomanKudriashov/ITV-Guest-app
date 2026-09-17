"""
Разбор отзыва: новый → разбирается → закрыт, с комментарием «что сделали».
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.reviews.models import ReviewAction
from tests.chat.api.test_chat_reviews import _finished_order, guest_for
from tests.reviews.test_reviews_section import _as, two_venue_review  # noqa: F401
from tests.orders.api.test_guest_service_cart import aggregator  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def low_review(client, crystal):
    guest = guest_for(client, crystal, room="212")
    order_id = _finished_order(client, crystal, guest, key="triage-low")
    return guest.post(f"/api/guest/order/{order_id}/review", {"rating": 1, "comment": "ужасно"}).json()["id"]


def _step(cms, review_id, status, comment=""):
    return cms.post(f"/api/cms/reviews/{review_id}/triage", {"status": status, "comment": comment})


def _item(cms, review_id, query=""):
    items = cms.get(f"/api/cms/reviews?limit=100{query}").json()["items"]
    return next((i for i in items if i["id"] == review_id), None)


def test_a_review_starts_new_and_goes_through_triage(crystal, cms, low_review):
    assert _item(cms, low_review)["triage"] == "new"
    assert _item(cms, low_review, "&triage=open") is not None

    assert _step(cms, low_review, "in_progress", "позвонили на кухню").json()["triage"] == "in_progress"
    closed = _step(cms, low_review, "closed", "повару замечание, гостю десерт")
    assert closed.status_code == 200 and closed.json()["triage"] == "closed"
    assert _item(cms, low_review, "&triage=open") is None, "закрытый не ждёт разбора"
    assert _item(cms, low_review, "&triage=closed") is not None

    history = cms.get(f"/api/cms/reviews/{low_review}").json()["triage"]
    assert [(h["from"], h["to"]) for h in history] == [("new", "in_progress"), ("in_progress", "closed")]
    assert history[-1]["comment"] == "повару замечание, гостю десерт" and history[-1]["by"]


def test_closing_needs_words(cms, low_review):
    response = _step(cms, low_review, "closed", "  ")
    assert response.status_code == 422 and response.json()["code"] == "triage_comment_required"


def test_back_to_new_is_refused_but_reopening_works(cms, low_review):
    assert _step(cms, low_review, "new").status_code == 422
    _step(cms, low_review, "closed", "разобрались")
    assert _step(cms, low_review, "in_progress", "гость пожаловался снова").json()["triage"] == "in_progress"


def test_a_note_without_a_status_change_is_kept(crystal, cms, low_review):
    _step(cms, low_review, "in_progress", "первое")
    assert _step(cms, low_review, "in_progress").status_code == 422, "пустой шаг ничего не значит"
    assert _step(cms, low_review, "in_progress", "второе").status_code == 200
    with tenant_context(crystal):
        assert ReviewAction.objects.filter(review_id=low_review).count() == 2


def test_replying_starts_the_triage(cms, low_review):
    cms.post(f"/api/cms/reviews/{low_review}/reply", {"text": "Простите"})
    assert _item(cms, low_review)["triage"] == "in_progress"


def test_the_summary_counts_the_queue(cms, low_review):
    before = cms.get("/api/cms/reviews/summary").json()["awaiting"]
    _step(cms, low_review, "closed", "готово")
    assert cms.get("/api/cms/reviews/summary").json()["awaiting"] == before - 1
    assert cms.get("/api/cms/reviews/summary?triage=closed").json()["awaiting"] == before - 1, (
        "очередь не обнуляется оттого, что смотрят закрытые"
    )


def test_a_manager_of_another_venue_cannot_triage(client, crystal, two_venue_review):  # noqa: F811
    spa = _as(client, crystal, "manager.spa")
    assert _step(spa, two_venue_review, "in_progress", "не моё").status_code == 404
    bar = _as(client, crystal, "manager.bar")
    assert _step(bar, two_venue_review, "in_progress", "бар разбирает").status_code == 200


def test_unknown_status_is_refused(cms, low_review):
    assert _step(cms, low_review, "done", "x").status_code == 422
    assert cms.get("/api/cms/reviews?triage=whatever").status_code == 422
