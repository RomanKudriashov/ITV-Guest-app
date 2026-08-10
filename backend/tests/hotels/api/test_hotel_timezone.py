"""
Часовой пояс отеля: один источник для часов и расписаний.

Почему это отдельный набор. Время на главной и «открыто до 23:00» — две разные
дороги в коде, и разойтись они могут незаметно: часы возьмут пояс отеля, а
расписание — пояс сервера, и оба будут выглядеть правдоподобно. Разница
всплывёт только у отеля, чей пояс не совпадает с серверным, то есть у любого,
кроме московского.

Поэтому здесь проверяется НЕ «время показывается», а «время и расписание
считаются от ОДНОГО пояса, и этот пояс — отельный».
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime

import pytest
from django.utils import timezone as dj_timezone

from apps.catalog.services.showcase import build_showcase
from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _guest_home(client, hotel: Hotel) -> dict:
    """Гостевая главная так, как её видит витрина: сессия в номере и снимок."""
    session = client.post(
        "/api/guest/session",
        data={"room_number": "201", "language": "ru"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert session.status_code == 200, session.content
    token = session.json()["token"]
    home = client.get(
        "/api/guest/home",
        HTTP_AUTHORIZATION=f"Bearer {token}",
        HTTP_HOST=host_for(hotel),
    )
    assert home.status_code == 200, home.content
    return home.json()


def _set_timezone(hotel: Hotel, name: str) -> None:
    hotel.timezone = name
    hotel.save(update_fields=["timezone"])


def test_guest_sees_hotel_timezone_not_the_server_one(client, crystal):
    """
    Гость получает пояс ОТЕЛЯ, а не сервера.

    Сервер живёт в UTC (`TIME_ZONE = "UTC"`), и пояс, унаследованный от него,
    выглядел бы работающим ровно до первого отеля за пределами Гринвича.
    """
    _set_timezone(crystal, "Asia/Vladivostok")

    home = _guest_home(client, crystal)

    assert home["hotel"]["timezone"] == "Asia/Vladivostok"
    assert home["hotel"]["timezone"] != dj_timezone.get_current_timezone_name()


def test_cms_change_reaches_the_guest(cms, client, crystal):
    """Смена пояса в CMS доезжает до витрины, а не оседает в базе."""
    payload = cms.get("/api/v1/cms/home-settings").json()
    assert "timezone" in payload, "пояса нет в настройках — оператор его не увидит"
    assert payload["timezone_options"], "список зон пуст — выбирать не из чего"

    saved = cms.put(
        "/api/v1/cms/home-settings",
        {**payload, "timezone": "Asia/Kolkata"},
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["timezone"] == "Asia/Kolkata"

    home = _guest_home(client, crystal)
    assert home["hotel"]["timezone"] == "Asia/Kolkata"


def test_unknown_timezone_is_refused(cms):
    """
    Опечатка отклоняется, а не превращается в UTC.

    `Hotel.tzinfo` на неизвестном имени молча отдаёт UTC — отель во Владивостоке
    начал бы показывать лондонское время, ничем не выдав ошибки ввода.
    """
    payload = cms.get("/api/v1/cms/home-settings").json()
    refused = cms.put("/api/v1/cms/home-settings", {**payload, "timezone": "Europe/Moskva"})
    assert refused.status_code == 422, refused.content
    assert "Moskva" in refused.content.decode()

    assert cms.get("/api/v1/cms/home-settings").json()["timezone"] != "Europe/Moskva"


@pytest.mark.parametrize(
    ("name", "offset_minutes"),
    [
        ("Asia/Vladivostok", 10 * 60),
        # Получасовые сдвиги: смещением такое не задать, именем — задаётся.
        ("Asia/Kolkata", 5 * 60 + 30),
        ("Asia/Tehran", 3 * 60 + 30),
    ],
)
def test_half_hour_zones_are_computed_by_name(crystal, name, offset_minutes):
    _set_timezone(crystal, name)
    now = dj_timezone.now()
    local = crystal.to_local(now)
    assert local.utcoffset().total_seconds() / 60 == offset_minutes


def test_daylight_saving_moves_with_the_date(crystal):
    """
    Летнее время считается ПО ДАТЕ, а не фиксированным смещением.

    Зона выбрана намеренно: у Москвы перехода нет, и на ней проверка прошла бы
    при любой реализации.
    """
    _set_timezone(crystal, "Europe/Berlin")
    winter = datetime(2026, 1, 15, 12, 0, tzinfo=zoneinfo.ZoneInfo("UTC"))
    summer = datetime(2026, 7, 15, 12, 0, tzinfo=zoneinfo.ZoneInfo("UTC"))

    assert crystal.to_local(winter).hour == 13
    assert crystal.to_local(summer).hour == 14


def test_schedule_and_clock_read_the_same_timezone(crystal):
    """
    ГЛАВНОЕ В ЭТОМ НАБОРЕ.

    Часы на главной и состояние заведений обязаны меняться ВМЕСТЕ: это один
    пояс, а не два похожих. Проверяется не «закрыто в три ночи» — проверяется,
    что обе величины отвечают на одну и ту же смену пояса.
    """
    states: dict[str, tuple[int, set[str]]] = {}
    for name in ("Asia/Vladivostok", "Pacific/Midway"):
        _set_timezone(crystal, name)
        moment = crystal.local_now()
        with tenant_context(crystal):
            tiles = build_showcase(crystal, moment=moment)
        venues = {
            tile["status"]["state"] for tile in tiles if tile.get("status") and tile.get("title")
        }
        states[name] = (moment.hour, venues)

    east_hour, east_states = states["Asia/Vladivostok"]
    west_hour, west_states = states["Pacific/Midway"]

    # Сутки развёрнуты на 21 час: если бы расписание считалось от серверного
    # пояса, состояния совпали бы при разных часах — ровно этот разрыв и ловим.
    assert east_hour != west_hour, "часы не сдвинулись — пояс не доехал до часов"
    assert east_states != west_states or east_states == west_states == set(), (
        "состояние заведений одинаково в двух концах суток — расписание считает "
        "не от пояса отеля"
    )
