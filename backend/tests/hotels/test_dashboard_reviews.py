"""
Отзывы на пульте (пункт 30 разбора).

Раньше из отзывов на пульт выходила ОДНА СРЕДНЯЯ ОЦЕНКА. Средняя молчит ровно
о том, что требует действия: на стенде она показывала 4,05 при двадцати шести
отзывах, ждущих ответа, и пульт об этом не говорил ни словом.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.services.dashboard import build
from apps.reviews.models import Review, TriageStatus
from tests.chat.api.test_chat_reviews import _finished_order, guest_for
from tests.orders.api.test_guest_service_cart import aggregator  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded_review(client, crystal):
    """Низкий отзыв, который никто ещё не разбирал, — самый частый случай."""
    guest = guest_for(client, crystal, room="212")
    order_id = _finished_order(client, crystal, guest, key="board-low")
    review_id = guest.post(
        f"/api/guest/order/{order_id}/review", {"rating": 1, "comment": "долго несли"}
    ).json()["id"]
    with tenant_context(crystal):
        return Review.objects.get(pk=review_id)


def _admin(crystal):
    from apps.accounts.models import User

    with tenant_context(crystal):
        return User.objects.filter(is_hotel_admin=True).first()


def _board(crystal):
    with tenant_context(crystal):
        return build(crystal, _admin(crystal))


def test_awaiting_reviews_raise_a_card(crystal, seeded_review):  # noqa: F811
    board = _board(crystal)
    card = next((c for c in board["attention"] if c["code"] == "reviews_awaiting"), None)
    assert card is not None, "отзыв ждёт ответа, а пульт молчит"
    assert card["count"] >= 1
    assert card["route"] == "/cms/reviews"


def test_a_low_review_makes_the_card_red(crystal, seeded_review):
    """Недовольный гость без ответа — ошибка, а не очередь."""
    board = _board(crystal)
    card = next(c for c in board["attention"] if c["code"] == "reviews_awaiting")
    assert card["severity"] == "error"
    assert card["low"] >= 1


def test_the_board_shows_the_low_ones_with_a_way_in(crystal, seeded_review):
    board = _board(crystal)
    rows = board["reviews"]["items"]
    assert rows, "блок отзывов пуст, хотя низкий отзыв ждёт ответа"
    assert str(seeded_review.pk) in {row["id"] for row in rows}
    row = next(row for row in rows if row["id"] == str(seeded_review.pk))
    assert row["route"].endswith(str(seeded_review.pk)), "из блока некуда перейти"
    assert row["rating"] == seeded_review.rating


def test_a_closed_review_leaves_the_board(crystal, seeded_review):
    """Разобрали — с пульта ушло: пульт показывает работу, а не историю."""
    with tenant_context(crystal):
        Review.objects.filter(pk=seeded_review.pk).update(triage_status=TriageStatus.CLOSED)
    board = _board(crystal)
    assert not any(c["code"] == "reviews_awaiting" for c in board["attention"])
    assert board["reviews"]["items"] == []


def test_a_high_review_waits_but_does_not_fill_the_board(crystal, seeded_review):
    """
    Пятёрка без ответа — тоже очередь, но не то, с чем бегут: она попадает в
    счёт ждущих и НЕ попадает в список низких.
    """
    with tenant_context(crystal):
        Review.objects.filter(pk=seeded_review.pk).update(rating=5, low_threshold=2)
    board = _board(crystal)
    card = next(c for c in board["attention"] if c["code"] == "reviews_awaiting")
    assert card["count"] >= 1
    assert card["severity"] == "warning", "пятёрка без ответа — не красная тревога"
    assert str(seeded_review.pk) not in {row["id"] for row in board["reviews"]["items"]}
