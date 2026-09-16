"""
Точка выдачи — третий вид локации: гость забирает заказ сам.

Способ следует из вида, поэтому у точки выдачи нет ни платы за доставку, ни
уточнения места. Явно присланные — ошибка формы, а не тихо выброшенное
значение.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db

LOCATIONS = "/api/cms/locations"


def _create(cms, **extra):
    return cms.post(LOCATIONS, {"title": {"ru": "Стойка бара"}, **extra})


def test_a_pickup_point_is_created_without_a_fee(cms):
    response = _create(cms, kind="pickup_point")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["kind"] == "pickup_point"
    assert body["delivery_fee_minor"] == 0
    assert body["requires_refinement"] is False


@pytest.mark.parametrize(
    ("extra", "code"),
    [
        ({"delivery_fee_minor": 15000}, "pickup_point_fee"),
        ({"requires_refinement": True, "refinement_label": {"ru": "Столик"}}, "pickup_point_refinement"),
    ],
)
def test_a_pickup_point_rejects_delivery_attributes(cms, extra, code):
    response = _create(cms, kind="pickup_point", **extra)
    assert response.status_code == 422, response.content
    assert code in response.content.decode()


def test_switching_to_a_pickup_point_drops_delivery_attributes(cms):
    created = _create(
        cms, kind="common_point", delivery_fee_minor=20000,
        requires_refinement=True, refinement_label={"ru": "Столик"},
    )
    assert created.status_code == 201, created.content
    assert created.json()["delivery_fee_minor"] == 20000, "плата при создании больше не теряется"

    switched = cms.patch(f"{LOCATIONS}/{created.json()['id']}", {"kind": "pickup_point"})
    assert switched.status_code == 200, switched.content
    body = switched.json()
    assert (body["delivery_fee_minor"], body["requires_refinement"], body["refinement_label"]) == (
        0, False, {},
    )


def test_an_unknown_kind_is_rejected(cms):
    response = _create(cms, kind="teleport")
    assert response.status_code == 422
    assert "invalid_location_kind" in response.content.decode()
