"""
ЯРКОСТЬ НОЧНОГО КАДРА — НАСТРОЙКА ПЛАНА (партия 64-1).

Вечерний кадр Gemini («Сиалия», 204) после расчёта уходил в черноту: мебель
не читалась. Множитель остатков света живёт в плане, двигается ползунком в
редакторе, и смена значения пересчитывает ПОСЧИТАННЫЙ ночной кадр. Принесённый
ночной кадр — свой, его не трогаем.
"""

from __future__ import annotations

import pytest
from PIL import Image, ImageStat

from apps.core.context import tenant_context
from apps.grms.models import RoomType
from apps.grms.schemas.cms import PlanGeometryIn
from apps.grms.services import nightframe, plan_editor

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _median(image: Image.Image) -> float:
    return ImageStat.Stat(image.convert("L")).median[0]


def test_brighter_night_frame_is_brighter_and_default_is_unchanged():
    source = Image.new("RGB", (64, 48), (150, 130, 110))
    default = nightframe.bake(source)
    assert list(default.getdata()) == list(nightframe.bake(source, brightness=1.0).getdata())
    assert _median(nightframe.bake(source, brightness=2.0)) > _median(default) + 5


def test_brightness_is_clamped():
    assert nightframe.clamp_brightness(10) == nightframe.BRIGHTNESS_MAX
    assert nightframe.clamp_brightness(0) == nightframe.BRIGHTNESS_MIN
    assert nightframe.clamp_brightness("мусор") == nightframe.BRIGHTNESS_DEFAULT


def _type(hotel, source: str) -> RoomType:
    with tenant_context(hotel):
        return RoomType.objects.create(
            hotel=hotel,
            code=f"night-{source}",
            title={"ru": "Ночь"},
            plan_level=RoomType.PlanLevel.FULL,
            plan={"asset_id": "lit-1", "asset_off_id": "off-1", "asset_off_source": source},
        )


def _save(hotel, code: str, brightness: float):
    return plan_editor.save_geometry(hotel, code, PlanGeometryIn(night_brightness=brightness))


def test_bite_new_brightness_rebakes_the_computed_night_frame(crystal, monkeypatch):
    from apps.grms.tasks import bake_room_plan_night

    launched: list[dict] = []
    monkeypatch.setattr(bake_room_plan_night, "delay", lambda **kw: launched.append(kw))
    monkeypatch.setattr(plan_editor, "payload", lambda hotel, code: {})
    room_type = _type(crystal, "baked")

    _save(crystal, room_type.code, 2.0)

    assert [kw["lit_asset_id"] for kw in launched] == ["lit-1"], "ночной кадр не пересчитан"
    with tenant_context(crystal):
        plan = RoomType.objects.get(pk=room_type.pk).plan
    assert plan["night_brightness"] == 2.0
    # Старый кадр остаётся до нового: публикация в эти секунды не увезёт гостю
    # план без ночного кадра. Редактор ждёт новый по признаку.
    assert plan["asset_off_id"] == "off-1"
    assert plan["asset_off_pending"] is True

    launched.clear()
    _save(crystal, room_type.code, 2.0000000000001)
    assert launched == [], "то же значение — пересчёт впустую"


def test_uploaded_night_frame_is_not_touched(crystal, monkeypatch):
    from apps.grms.tasks import bake_room_plan_night

    launched: list[dict] = []
    monkeypatch.setattr(bake_room_plan_night, "delay", lambda **kw: launched.append(kw))
    monkeypatch.setattr(plan_editor, "payload", lambda hotel, code: {})
    room_type = _type(crystal, "uploaded")

    _save(crystal, room_type.code, 2.5)

    assert launched == []
    with tenant_context(crystal):
        assert RoomType.objects.get(pk=room_type.pk).plan["asset_off_id"] == "off-1"
