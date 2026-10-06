"""
Проход обложек сида просит снимок только у заведений демо-набора (п.17).

Он шёл по всем сервисам отеля и на каждое заведение не из манифеста —
остаток прогона, заведение, созданное отелем, — печатал «фото недоступно,
прогоните fetch_seed_photos»: на стенде разработки 191 строка шума, похожего
на пропавшую картинку. Без MinIO и сети: `_image_for` подменён записью.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.management.commands.seed_demo_hotel import Command
from apps.hotels.models import ExecutionPoint, Service

pytestmark = pytest.mark.django_db


def test_covers_are_asked_only_for_venues_from_the_manifest(crystal):
    asked: list[str] = []
    command = Command()
    command._skip_media = False
    command._image_for = lambda code, label: asked.append(code)  # type: ignore[method-assign]

    with tenant_context(crystal):
        point = ExecutionPoint.objects.create(hotel_id=crystal.id, code="rum-servis-e2e123", title={"ru": "Рум-сервис e2e"})
        Service.objects.create(
            hotel_id=crystal.id, code="rum-servis-e2e123", execution_point=point,
            type=Service.Type.ROOM_SERVICE, public_name={"ru": "Рум-сервис e2e"},
        )
        # Демо-заведение без обложки — его снимок проход обязан попросить.
        Service.objects.filter(code="kitchen").update(image=None)
        command._seed_venue_covers()

    assert "venue-rum-servis-e2e123" not in asked, "заведение не из манифеста снимка не ждёт"
    assert "venue-kitchen" in asked
