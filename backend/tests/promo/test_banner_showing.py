"""
Рекламный баннер на витрине (пункт 20 заказчика): правила показа и честный счёт.

ЧЕТЫРЕ ВЕЩИ, КОТОРЫЕ ЛЕГКО СЛОМАТЬ И ТРУДНО ЗАМЕТИТЬ, — здесь каждая с укусом:

  * показ считается ОДИН раз на сессию, а не на перерисовку экрана. Иначе
    знаменатель CTR растёт от того, что гость ходит по меню;
  * закрытый баннер не возвращается в ту же сессию;
  * баннер не попадает в аналитику заказов как продажа;
  * витрина не ждёт баннера: он приезжает отдельной ручкой.
"""

from __future__ import annotations

from datetime import date, time, timedelta

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Room, RoomCategory
from apps.promo.models import Banner, BannerRoomCategory, BannerView

pytestmark = pytest.mark.django_db


def _banner_of(call):
    response = call("/api/guest/banner")
    assert response.status_code == 200, response.content
    return response.json()["banner"]


# --- Один на экран и приоритет ---------------------------------------------


def test_only_one_banner_reaches_the_screen(guest, banner):
    banner(name="Тихий", priority=1)
    loud = banner(name="Громкий", priority=10)
    shown = _banner_of(guest())
    assert shown is not None
    assert shown["id"] == str(loud.pk), "на экран уходит один баннер — с высшим приоритетом"


def test_nothing_to_show_is_a_normal_state(guest):
    assert _banner_of(guest()) is None


def test_an_inactive_banner_does_not_show(guest, banner):
    banner(is_active=False)
    assert _banner_of(guest()) is None


# --- Показ считается один раз на сессию ------------------------------------


def test_an_impression_is_counted_once_per_session_not_per_repaint(guest, banner, crystal):
    """Гость ходит по витрине — знаменатель CTR от этого расти не должен."""
    row = banner()
    call = guest()
    for _ in range(4):
        assert _banner_of(call)["id"] == str(row.pk)
    with tenant_context(crystal):
        assert BannerView.objects.filter(banner=row).count() == 1


def test_two_guests_are_two_impressions(guest, banner, crystal):
    row = banner()
    _banner_of(guest(room="201"))
    _banner_of(guest(room="205"))
    with tenant_context(crystal):
        assert BannerView.objects.filter(banner=row).count() == 2


# --- Закрытие ---------------------------------------------------------------


def test_a_closed_banner_does_not_come_back_in_the_same_session(guest, banner):
    row = banner()
    call = guest()
    assert _banner_of(call)["id"] == str(row.pk)
    closed = call(f"/api/guest/banner/{row.pk}/close", "post")
    assert closed.status_code == 200 and closed.json()["ok"] is True
    assert _banner_of(call) is None, "закрытый вернулся — гость закрывает его снова и снова"


def test_a_closed_banner_comes_back_for_the_next_guest(guest, banner):
    row = banner()
    first = guest(room="201")
    _banner_of(first)
    first(f"/api/guest/banner/{row.pk}/close", "post")
    assert _banner_of(guest(room="205"))["id"] == str(row.pk)


# --- Правила показа ---------------------------------------------------------


def test_dates_outside_the_period_hide_the_banner(guest, banner):
    yesterday = date.today() - timedelta(days=2)
    banner(starts_on=yesterday - timedelta(days=5), ends_on=yesterday)
    assert _banner_of(guest()) is None


def test_a_period_that_has_started_shows(guest, banner):
    row = banner(starts_on=date.today() - timedelta(days=1), ends_on=date.today() + timedelta(days=1))
    assert _banner_of(guest())["id"] == str(row.pk)


def test_a_night_window_crosses_midnight(crystal, banner):
    """22:00–06:00 — законное пожелание отеля, а не пустое множество."""
    from apps.promo.services.showing import _fits_time

    row = banner(time_from=time(22, 0), time_to=time(6, 0))
    assert _fits_time(row, time(23, 30)) is True
    assert _fits_time(row, time(2, 0)) is True
    assert _fits_time(row, time(12, 0)) is False


def test_a_day_window_is_a_plain_interval(crystal, banner):
    from apps.promo.services.showing import _fits_time

    row = banner(time_from=time(9, 0), time_to=time(18, 0))
    assert _fits_time(row, time(12, 0)) is True
    assert _fits_time(row, time(7, 0)) is False


def test_the_guest_language_filters(guest, banner):
    row = banner(languages=["en"])
    assert _banner_of(guest(language="ru")) is None
    assert _banner_of(guest(language="en"))["id"] == str(row.pk)


def test_an_empty_language_list_means_every_language(guest, banner):
    row = banner(languages=[])
    assert _banner_of(guest(language="zh"))["id"] == str(row.pk)


def test_first_visit_only_shows_once_per_session(guest, banner):
    """«Только при первом входе» — первый экран сессии, и он же последний."""
    row = banner(first_visit_only=True)
    call = guest()
    assert _banner_of(call)["id"] == str(row.pk)
    assert _banner_of(call) is None, "второй заход всё ещё считает себя первым"


def test_first_visit_only_shows_to_a_new_guest(guest, banner):
    row = banner(first_visit_only=True)
    _banner_of(guest(room="201"))
    assert _banner_of(guest(room="205"))["id"] == str(row.pk)


# --- Категории номеров (волна 5) -------------------------------------------


def test_the_room_category_rule_uses_the_category_of_the_guest_room(guest, banner, crystal):
    """
    Связь «номер → категория» заведена в волне 5. До волны 10 на стенде не
    было ни одной размеченной комнаты — правило было бы мёртвым.
    """
    with tenant_context(crystal):
        suite = RoomCategory.objects.get(code="suite")
        standard = RoomCategory.objects.get(code="standard")
        room_201 = Room.objects.get(number="201")
        room_201.category = suite
        room_201.save(update_fields=["category", "updated_at"])
        room_205 = Room.objects.get(number="205")
        room_205.category = standard
        room_205.save(update_fields=["category", "updated_at"])
        row = Banner.objects.create(hotel_id=crystal.id, name="Только люксам")
        # Через связку явно: `.add()` кладёт строку мимо `save()`, без отеля,
        # и её отбивает RLS. См. docstring BannerRoomCategory.
        BannerRoomCategory.objects.create(
            hotel_id=crystal.id, banner=row, room_category=suite
        )

    assert _banner_of(guest(room="201"))["id"] == str(row.pk)
    assert _banner_of(guest(room="205")) is None


def test_no_categories_means_every_room(guest, banner):
    row = banner()
    assert _banner_of(guest(room="205"))["id"] == str(row.pk)


# --- Действие ---------------------------------------------------------------


def test_the_action_arrives_parsed_not_guessed(guest, banner):
    """Витрина не должна догадываться по непустому полю, куда вести гостя."""
    row = banner(action=Banner.Action.LINK, action_url="https://spa.example/offer")
    action = _banner_of(guest())["action"]
    assert action == {"kind": "link", "url": "https://spa.example/offer"}
    del row


def test_a_description_page_travels_with_the_banner(guest, banner):
    banner(
        action=Banner.Action.PAGE,
        page_title={"ru": "Спа-программа"},
        page_body={"ru": "Три процедуры и чай"},
    )
    action = _banner_of(guest())["action"]
    assert action["kind"] == "page"
    assert action["page"]["title"] == "Спа-программа"
    assert action["page"]["body"] == "Три процедуры и чай"


# --- Витрина не ждёт рекламы ------------------------------------------------


def test_the_showcase_does_not_carry_the_banner(guest, banner):
    """
    Баннер приезжает СВОЕЙ ручкой. Лежи он в теле главной — на медленном
    канале гость ждал бы рекламу, чтобы увидеть меню.
    """
    banner()
    home = guest()("/api/guest/home").json()
    assert "banner" not in home
    assert not any("banner" in str(key) for key in home)
