"""
УДАЛЁННОЕ ЗАВЕДЕНИЕ УХОДИТ С ПУЛЬТА (п.37, решение 06.10.2026).

Пульт считает по очередям (точкам исполнения). Заведение, удалённое мимо
`delete_service`, оставляло включённой свою очередь — строка-призрак висела
на пульте, пока точку не выключали руками. Теперь удаление заведения
выключает его очередь, если других живых заведений на ней нет; очередь не
удаляется — к ней привязана история заказов.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db


def _venue_codes(cms) -> set[str]:
    response = cms.get("/api/v1/cms/dashboard")
    assert response.status_code == 200, response.content
    body = response.json()
    return {venue["code"] for venue in body.get("venues", [])}


def test_a_deleted_venue_turns_its_queue_off_and_leaves_the_dashboard(cms, crystal):
    with tenant_context(crystal):
        point = ExecutionPoint.objects.create(hotel_id=crystal.id, code="ghost-bar", title={"ru": "Бар-призрак"})
        service = Service.objects.create(
            hotel_id=crystal.id, code="ghost-bar", execution_point=point,
            type=Service.Type.BAR, public_name={"ru": "Бар-призрак"},
        )
    assert "ghost-bar" in _venue_codes(cms), "живое заведение на пульте есть"

    with tenant_context(crystal):
        service.delete()
        point.refresh_from_db()
        assert point.is_active is False, "очередь удалённого заведения выключена"
        assert point.deleted_at is None, "очередь не удаляется — к ней привязана история"
    assert "ghost-bar" not in _venue_codes(cms)


def test_a_queue_shared_with_a_live_venue_stays_on(crystal):
    """Очередь, на которой есть другое живое заведение, не выключается."""
    from apps.hotels.models.service import retire_orphan_points

    with tenant_context(crystal):
        kitchen = Service.objects.get(code="kitchen")
        assert retire_orphan_points([kitchen.execution_point_id]) == 0
        kitchen.execution_point.refresh_from_db()
        assert kitchen.execution_point.is_active is True
