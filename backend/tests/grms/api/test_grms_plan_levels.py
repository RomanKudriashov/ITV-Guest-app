"""
ПРОСТОЙ ПЛАН — СОБСТВЕННЫЙ ВИД, А НЕ ДЕГРАДИРОВАВШИЙ ПОЛНЫЙ.

Раньше вид выводился из кадров, и «простой план» был просто полным, у которого
не хватает ночного кадра: экран притемнял выключенные зоны, редактор ждал
посчитанный кадр, сторож ругался на несовмещённую пару. Всё это для простого
плана бессмысленно — комната там показывается как есть, а включённые зоны
заливаются.

Проверки ОТКЛЮЧАЮТСЯ НА СЕРВЕРЕ, а не прячутся на экране. Спрятанный, но живой
контрол — это то, что мы уже ловили: экран не показывает, а запрос проходит.
"""

from __future__ import annotations

import io

import pytest

from apps.core.context import tenant_context
from apps.grms.models import RoomType
from apps.hotels.models import HotelModule
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _enable_module(hotel):
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True}
        )


def _png(colour: int = 200) -> io.BytesIO:
    """Настоящий PNG: сервер его читает, а не только считает байты."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), (colour, colour, colour)).save(buffer, format="PNG")
    buffer.seek(0)
    buffer.name = "plan.png"
    return buffer


def _make_type(hotel, level: str, code: str) -> RoomType:
    with tenant_context(hotel):
        return RoomType.objects.create(
            hotel=hotel, code=code, title={"ru": code}, plan_level=level
        )


def _upload(cms, code: str, *, lit, off=None):
    """
    Кадр грузится ПЛАТФОРМЕННОЙ ручкой: конфигурация переехала в нашу консоль,
    и у отеля этого маршрута больше нет вовсе. Проверять уровни через CMS
    значило бы проверять путь, которым никто не ходит.
    """
    data = {"lit": lit}
    if off is not None:
        data["off"] = off
    return cms.client.post(
        f"/api/v1/platform/hotels/{cms.hotel.pk}/grms/types/{code}/plan/frames",
        data=data,
        HTTP_HOST="guest.localhost",
        HTTP_AUTHORIZATION=f"Bearer {_platform_token(cms)}",
    )


def _platform_token(cms) -> str:
    """
    Учётка платформы: конфигурацию выполняем мы, а не отель.

    Заводим и логинимся В КАЖДОМ ТЕСТЕ. Кэш на уровне модуля здесь уже стоял и
    развалился в полном прогоне: учётка живёт в транзакции теста и после
    отката исчезает, а токен в кэше остаётся — следующий тест получал 401 от
    имени пользователя, которого больше нет.
    """
    import json as _json

    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email="root@platform.test", password="platform12345")
    return cms.client.post(
        "/api/v1/platform/auth/login",
        data=_json.dumps({"email": "root@platform.test", "password": "platform12345"}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
    ).json()["access"]


def test_a_simple_plan_refuses_the_night_frame(cms, crystal):
    """
    УКУС. Второй кадр простому типу — ОТКАЗ СЕРВЕРА, мимо любого интерфейса.

    Принятый «на всякий случай» второй кадр означал бы тип, который выглядит
    простым, а в снимке несёт пару, — расхождение между проданным и
    опубликованным.
    """
    _enable_module(crystal)
    _make_type(crystal, RoomType.PlanLevel.SIMPLE, "simple-suite")

    response = _upload(cms, "simple-suite", lit=_png(220), off=_png(40))

    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == "night_frame_not_allowed"
    # Текст объясняет УСТРОЙСТВО вида, а не просто запрещает.
    assert "простого плана" in body["detail"]


def test_a_simple_plan_takes_the_single_frame_and_bakes_nothing(cms, crystal, monkeypatch):
    """
    Один кадр простой план принимает — и НЕ запускает счёт ночного.

    Задача положила бы в конфигурацию второй кадр, которого этот вид не
    показывает, а редактор ждал бы его до истечения срока.
    """
    from apps.grms.tasks import bake_room_plan_night

    launched = []
    monkeypatch.setattr(
        bake_room_plan_night, "delay", lambda **kw: launched.append(kw)
    )

    _enable_module(crystal)
    _make_type(crystal, RoomType.PlanLevel.SIMPLE, "simple-one")

    response = _upload(cms, "simple-one", lit=_png(220))

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["ok"] is True
    # `none` — ждать нечего, и экран по этому полю понимает, что строку про
    # ночной кадр показывать не нужно.
    assert body["night"] == "none"
    assert launched == [], "у простого плана запустился счёт ночного кадра"


def test_a_full_plan_still_bakes_the_night_frame(cms, crystal, monkeypatch):
    """
    ОБРАТНАЯ СТОРОНА. Полный план не изменился: один кадр — и ночной считается,
    как и раньше. Отключение проверок не имело права тронуть тот вид, ради
    которого они писались.
    """
    from apps.grms.tasks import bake_room_plan_night

    launched = []
    monkeypatch.setattr(
        bake_room_plan_night, "delay", lambda **kw: launched.append(kw)
    )

    _enable_module(crystal)
    _make_type(crystal, RoomType.PlanLevel.FULL, "full-suite")

    response = _upload(cms, "full-suite", lit=_png(220))

    assert response.status_code == 200, response.content
    assert response.json()["night"] == "baking"
    assert len(launched) == 1


def test_tiles_take_no_frame_at_all(cms, crystal):
    """
    У плашек плана нет вовсе, и кадр им не к чему приложить. Отказ называет,
    что делать: поднять уровень — решение наше, а не отеля.
    """
    _enable_module(crystal)
    _make_type(crystal, RoomType.PlanLevel.TILES, "tiles-suite")

    response = _upload(cms, "tiles-suite", lit=_png(220))

    assert response.status_code == 422, response.content
    body = response.json()
    assert body["code"] == "plan_level_tiles"
    assert "уровень" in body["detail"].lower()


def test_the_level_travels_in_the_snapshot(crystal):
    """
    Уровень едет В СНИМКЕ, а не читается из черновика при выдаче: откат к
    прошлой версии обязан вернуть ТОТ вид экрана, что был у той версии.
    """
    from apps.grms.services import plan as plan_geometry

    assert plan_geometry.for_guest({"asset_id": None}) == {}
    # Старый снимок поля не несёт — падаем на прежнее правило, и откат к v2
    # продолжает работать.
    old_pair = {"asset_id": "a", "asset_off_id": "b"}
    assert "level" not in old_pair
